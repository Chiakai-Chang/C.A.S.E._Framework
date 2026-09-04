import {
  lstat,
  open,
  readdir,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

export interface PathInfo {
  readonly device: bigint;
  readonly inode: bigint;
  readonly hardLinkCount: bigint;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
  isReparsePoint(): boolean;
}

export interface DirectoryEntryInfo {
  readonly name: string;
}

export interface OpenedFile {
  readAll(): Promise<Uint8Array>;
  stat(): Promise<PathInfo>;
  close(): Promise<void>;
}

export interface PathInspectionPort {
  lstat(path: string): Promise<PathInfo>;
  realpath(path: string): Promise<string>;
  listDirectory(path: string): Promise<readonly DirectoryEntryInfo[]>;
  openRead(path: string): Promise<OpenedFile>;
}

function pathInfo(stats: Awaited<ReturnType<typeof lstat>>): PathInfo {
  return {
    device: BigInt(stats.dev),
    inode: BigInt(stats.ino),
    hardLinkCount: BigInt(stats.nlink),
    isDirectory: () => stats.isDirectory(),
    isFile: () => stats.isFile(),
    isSymbolicLink: () => stats.isSymbolicLink(),
    // Node classifies supported Windows symbolic-link and junction reparse tags here.
    isReparsePoint: () => stats.isSymbolicLink(),
  };
}

function openedFile(handle: FileHandle): OpenedFile {
  return {
    readAll: () => handle.readFile(),
    stat: async () => pathInfo(await handle.stat()),
    close: () => handle.close(),
  };
}

export const nodePathInspection: PathInspectionPort = {
  lstat: async (path) => pathInfo(await lstat(path)),
  realpath,
  listDirectory: async (path) => (await readdir(path, { withFileTypes: true })).map(({ name }) => ({ name })),
  openRead: async (path) => openedFile(await open(path, "r")),
};

function isLinkOrReparse(info: PathInfo): boolean {
  return info.isSymbolicLink() || info.isReparsePoint();
}

async function exactEntryExists(directory: string, name: string, fs: PathInspectionPort): Promise<boolean> {
  return (await fs.listDirectory(directory)).some((entry) => entry.name === name);
}

export interface GitDiscoveryPort {
  /** Return the Git-confirmed non-bare worktree root, or null when confirmation fails. */
  confirmWorktreeRoot(directory: string): Promise<string | null>;
}

const execFileAsync = promisify(execFile);

export const nodeGitDiscovery: GitDiscoveryPort = {
  async confirmWorktreeRoot(directory) {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", directory, "rev-parse", "--path-format=absolute", "--show-toplevel", "--is-inside-work-tree", "--is-bare-repository"],
        { encoding: "utf8", windowsHide: true },
      );
      const [root, inside, bare, ...extra] = stdout.trim().split(/\r?\n/);
      if (root === undefined || inside !== "true" || bare !== "false" || extra.length !== 0) return null;

      const configuredBare = await execFileAsync(
        "git",
        ["-C", directory, "config", "--local", "--type=bool", "--get", "core.bare"],
        { encoding: "utf8", windowsHide: true },
      );
      if (configuredBare.stdout.trim() !== "false") return null;

      try {
        const symbolic = await execFileAsync("git", ["-C", directory, "symbolic-ref", "-q", "HEAD"], {
          encoding: "utf8",
          windowsHide: true,
        });
        const reference = symbolic.stdout.trim();
        if (reference.length === 0) return null;
        await execFileAsync("git", ["check-ref-format", reference], { encoding: "utf8", windowsHide: true });
      } catch {
        await execFileAsync("git", ["-C", directory, "rev-parse", "--verify", "HEAD^{commit}"], {
          encoding: "utf8",
          windowsHide: true,
        });
      }
      return root;
    } catch {
      return null;
    }
  },
};

async function gitWorktreeMarker(
  directory: string,
  fs: PathInspectionPort,
  git: GitDiscoveryPort,
): Promise<"absent" | "valid" | "invalid"> {
  if (!await exactEntryExists(directory, ".git", fs)) return "absent";
  const marker = join(directory, ".git");
  const info = await fs.lstat(marker);
  if (isLinkOrReparse(info)) return "invalid";
  if (!info.isDirectory() && !info.isFile()) return "invalid";
  const confirmedRoot = await git.confirmWorktreeRoot(directory);
  if (confirmedRoot === null) return "invalid";
  return await fs.realpath(confirmedRoot) === await fs.realpath(directory) ? "valid" : "invalid";
}

/** Discover the closest validated Git work-tree owner without crossing a volume root. */
export async function discoverRepositoryRoot(
  start: string,
  fs: PathInspectionPort = nodePathInspection,
  git: GitDiscoveryPort = nodeGitDiscovery,
): Promise<string> {
  if (start.length === 0 || start.includes("\0")) {
    throw new Error("CASE_E_NOT_INITIALIZED: invalid start directory");
  }

  let current: string;
  try {
    current = await fs.realpath(isAbsolute(start) ? start : resolve(start));
    const startInfo = await fs.lstat(current);
    if (!startInfo.isDirectory() || isLinkOrReparse(startInfo)) throw new Error("not a directory");
  } catch {
    throw new Error("CASE_E_NOT_INITIALIZED: start directory is unavailable");
  }

  const volumeRoot = parse(current).root;
  while (true) {
    let marker: "absent" | "valid" | "invalid";
    try {
      marker = await gitWorktreeMarker(current, fs, git);
    } catch {
      throw new Error("CASE_E_NOT_INITIALIZED: repository ownership could not be proven");
    }
    if (marker === "valid") return current;
    if (marker === "invalid") {
      throw new Error("CASE_E_NOT_INITIALIZED: repository ownership marker is invalid");
    }
    if (current === volumeRoot) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("CASE_E_NOT_INITIALIZED: no owning repository found");
}

export interface OpenedEvidence {
  readonly handle: OpenedFile;
  readonly repository_relative_path: string;
}

function evidenceError(reason: string): Error {
  return new Error(`CASE_E_EVIDENCE: ${reason}`);
}

export function validateLexicalEvidencePath(lexicalPath: string): readonly string[] {
  if (lexicalPath.length === 0) throw evidenceError("path is empty");
  if (lexicalPath.includes("\0")) throw evidenceError("path contains NUL");
  if (lexicalPath.includes("\\")) throw evidenceError("backslashes are forbidden");
  if (lexicalPath.startsWith("/") || /^[A-Za-z]:/.test(lexicalPath)) {
    throw evidenceError("absolute paths are forbidden");
  }

  const segments = lexicalPath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw evidenceError("path contains a forbidden segment");
  }
  if (segments.some((segment) => segment.includes(":"))) {
    throw evidenceError("alternate data stream spellings are forbidden");
  }
  if (segments.some((segment) => /[ .]$/u.test(segment))) {
    throw evidenceError("trailing dot or space aliases are forbidden");
  }
  if (segments.some((segment) => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(segment))) {
    throw evidenceError("device aliases are forbidden");
  }
  return segments;
}

function sameIdentity(left: PathInfo, right: PathInfo): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function isContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot.length > 0
    && !isAbsolute(pathFromRoot)
    && pathFromRoot !== ".."
    && !pathFromRoot.startsWith(`..${sep}`);
}

/**
 * Open a regular evidence file after lexical, exact-segment, link, identity, and
 * containment checks. The caller owns the returned handle and must close it.
 */
export async function resolveEvidencePath(
  root: string,
  lexicalPath: string,
  fs: PathInspectionPort = nodePathInspection,
): Promise<OpenedEvidence> {
  // This validation intentionally precedes the first port access.
  const segments = validateLexicalEvidencePath(lexicalPath);

  let rootPath: string;
  try {
    rootPath = resolve(root);
    const rootInfo = await fs.lstat(rootPath);
    if (!rootInfo.isDirectory() || isLinkOrReparse(rootInfo)) throw evidenceError("unsafe repository root");
    const canonicalRoot = await fs.realpath(rootPath);
    if (canonicalRoot !== rootPath) throw evidenceError("repository root is an alias");
    rootPath = canonicalRoot;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("CASE_E_EVIDENCE:")) throw error;
    throw evidenceError("repository root is unavailable");
  }

  let parent = rootPath;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    let names: readonly DirectoryEntryInfo[];
    try {
      names = await fs.listDirectory(parent);
    } catch {
      throw evidenceError("path parent is unavailable");
    }
    const foldedMatches = names.filter((entry) => entry.name.toLowerCase() === segment.toLowerCase());
    if (foldedMatches.length !== 1 || foldedMatches[0]!.name !== segment) {
      throw evidenceError("path spelling does not resolve exactly");
    }

    const candidate = join(parent, segment);
    let candidateInfo: PathInfo;
    try {
      candidateInfo = await fs.lstat(candidate);
    } catch {
      throw evidenceError("path segment is unavailable");
    }
    if (isLinkOrReparse(candidateInfo)) throw evidenceError("links and reparse points are forbidden");

    const final = index === segments.length - 1;
    if (!final) {
      if (!candidateInfo.isDirectory()) throw evidenceError("intermediate segment is not a directory");
      parent = candidate;
      continue;
    }
    if (!candidateInfo.isFile()) throw evidenceError("final path is not a regular file");
    if (candidateInfo.hardLinkCount !== 1n) throw evidenceError("hard-linked file aliases are forbidden");

    let handle: OpenedFile | undefined;
    try {
      handle = await fs.openRead(candidate);
      const openedInfo = await handle.stat();
      if (!openedInfo.isFile() || openedInfo.hardLinkCount !== 1n
        || isLinkOrReparse(openedInfo) || !sameIdentity(candidateInfo, openedInfo)) {
        throw evidenceError("file identity changed while opening");
      }
      const canonicalFinal = await fs.realpath(candidate);
      if (!isContained(rootPath, canonicalFinal)) throw evidenceError("resolved path escapes the repository");
      const afterOpen = await fs.lstat(candidate);
      if (afterOpen.hardLinkCount !== 1n || isLinkOrReparse(afterOpen) || !sameIdentity(openedInfo, afterOpen)) {
        throw evidenceError("file identity changed during validation");
      }
      return { handle, repository_relative_path: segments.join("/") };
    } catch (error) {
      if (handle !== undefined) await handle.close();
      if (error instanceof Error && error.message.startsWith("CASE_E_EVIDENCE:")) throw error;
      throw evidenceError("file could not be opened safely");
    }
  }

  throw evidenceError("path is empty");
}
