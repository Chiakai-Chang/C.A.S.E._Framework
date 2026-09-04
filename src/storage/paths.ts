import {
  lstat,
  open,
  readdir,
  readFile,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

export interface PathInfo {
  readonly device: bigint;
  readonly inode: bigint;
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
  readFile(path: string): Promise<Uint8Array>;
  listDirectory(path: string): Promise<readonly DirectoryEntryInfo[]>;
  openRead(path: string): Promise<OpenedFile>;
}

function pathInfo(stats: Awaited<ReturnType<typeof lstat>>): PathInfo {
  return {
    device: BigInt(stats.dev),
    inode: BigInt(stats.ino),
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
  readFile,
  listDirectory: async (path) => (await readdir(path, { withFileTypes: true })).map(({ name }) => ({ name })),
  openRead: async (path) => openedFile(await open(path, "r")),
};

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isLinkOrReparse(info: PathInfo): boolean {
  return info.isSymbolicLink() || info.isReparsePoint();
}

async function exactEntryExists(directory: string, name: string, fs: PathInspectionPort): Promise<boolean> {
  return (await fs.listDirectory(directory)).some((entry) => entry.name === name);
}

async function isPlainFile(path: string, fs: PathInspectionPort): Promise<boolean> {
  try {
    const info = await fs.lstat(path);
    return info.isFile() && !isLinkOrReparse(info);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function isPlainDirectory(path: string, fs: PathInspectionPort): Promise<boolean> {
  try {
    const info = await fs.lstat(path);
    return info.isDirectory() && !isLinkOrReparse(info);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function isGitCommonDirectory(path: string, fs: PathInspectionPort): Promise<boolean> {
  return await exactEntryExists(path, "HEAD", fs)
    && await exactEntryExists(path, "config", fs)
    && await exactEntryExists(path, "objects", fs)
    && await exactEntryExists(path, "refs", fs)
    && await isPlainFile(join(path, "HEAD"), fs)
    && await isPlainFile(join(path, "config"), fs)
    && await isPlainDirectory(join(path, "objects"), fs)
    && await isPlainDirectory(join(path, "refs"), fs)
    && await hasValidGitHead(join(path, "HEAD"), fs)
    && await hasWorktreeGitConfig(join(path, "config"), fs);
}

function decodeGitText(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

async function hasValidGitHead(path: string, fs: PathInspectionPort): Promise<boolean> {
  const source = decodeGitText(await fs.readFile(path));
  if (source === undefined || source.includes("\0")) return false;
  const head = source.replace(/\r?\n$/, "");
  if (/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(head)) return true;
  if (!head.startsWith("ref: refs/")) return false;
  const reference = head.slice("ref: ".length);
  return !reference.includes("\\")
    && !reference.includes("//")
    && reference.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

async function hasWorktreeGitConfig(path: string, fs: PathInspectionPort): Promise<boolean> {
  const source = decodeGitText(await fs.readFile(path));
  if (source === undefined || source.includes("\0")) return false;
  return /^\s*\[core\]\s*$/im.test(source) && /^\s*bare\s*=\s*false\s*$/im.test(source);
}

async function isLinkedWorktreeMarker(marker: string, fs: PathInspectionPort): Promise<boolean> {
  const source = decodeGitText(await fs.readFile(marker));
  if (source === undefined || source.includes("\0")) return false;
  const match = /^gitdir: ([^\r\n]+)\r?\n?$/.exec(source);
  if (match === null) return false;

  const worktreeGitDirectory = resolve(dirname(marker), match[1]!);
  if (!await isPlainDirectory(worktreeGitDirectory, fs)) return false;
  if (!await isPlainFile(join(worktreeGitDirectory, "HEAD"), fs)
    || !await isPlainFile(join(worktreeGitDirectory, "commondir"), fs)
    || !await isPlainFile(join(worktreeGitDirectory, "gitdir"), fs)) return false;

  if (!await hasValidGitHead(join(worktreeGitDirectory, "HEAD"), fs)) return false;
  const commonSource = decodeGitText(await fs.readFile(join(worktreeGitDirectory, "commondir")));
  const backlinkSource = decodeGitText(await fs.readFile(join(worktreeGitDirectory, "gitdir")));
  if (commonSource === undefined || backlinkSource === undefined) return false;
  const commonPath = resolve(worktreeGitDirectory, commonSource.trim());
  const backlinkPath = resolve(worktreeGitDirectory, backlinkSource.trim());
  if (!await isGitCommonDirectory(commonPath, fs)) return false;

  return await fs.realpath(backlinkPath) === await fs.realpath(marker);
}

async function gitWorktreeMarker(
  directory: string,
  fs: PathInspectionPort,
): Promise<"absent" | "valid" | "invalid"> {
  if (!await exactEntryExists(directory, ".git", fs)) return "absent";
  const marker = join(directory, ".git");
  const info = await fs.lstat(marker);
  if (isLinkOrReparse(info)) return "invalid";
  if (info.isDirectory()) return await isGitCommonDirectory(marker, fs) ? "valid" : "invalid";
  if (info.isFile()) return await isLinkedWorktreeMarker(marker, fs) ? "valid" : "invalid";
  return "invalid";
}

/** Discover the closest validated Git work-tree owner without crossing a volume root. */
export async function discoverRepositoryRoot(
  start: string,
  fs: PathInspectionPort = nodePathInspection,
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
      marker = await gitWorktreeMarker(current, fs);
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

function validateLexicalEvidencePath(lexicalPath: string): readonly string[] {
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
    if (!names.some((entry) => entry.name === segment)) {
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

    let handle: OpenedFile | undefined;
    try {
      handle = await fs.openRead(candidate);
      const openedInfo = await handle.stat();
      if (!openedInfo.isFile() || isLinkOrReparse(openedInfo) || !sameIdentity(candidateInfo, openedInfo)) {
        throw evidenceError("file identity changed while opening");
      }
      const canonicalFinal = await fs.realpath(candidate);
      if (!isContained(rootPath, canonicalFinal)) throw evidenceError("resolved path escapes the repository");
      const afterOpen = await fs.lstat(candidate);
      if (isLinkOrReparse(afterOpen) || !sameIdentity(openedInfo, afterOpen)) {
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
