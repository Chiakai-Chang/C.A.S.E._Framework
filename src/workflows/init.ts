import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseGovernedJson } from "../protocol/json.js";
import { failure, success, type ResultEnvelope } from "../protocol/result.js";
import type { SchemaRegistry } from "../protocol/schema-registry.js";
import type { Manifest } from "../protocol/types.js";
import {
  discoverRepositoryRoot,
  nodePathInspection,
  type PathInspectionPort,
  type PathInfo,
} from "../storage/paths.js";

export interface RepositoryFileSystemPort extends PathInspectionPort {
  readonly profile: "windows-local" | "injected-atomic-directory-publish" | "unsupported";
  mkdir(path: string): Promise<void>;
  writeNewFile(path: string, bytes: Uint8Array): Promise<void>;
  publishNewDirectory(source: string, target: string): Promise<void>;
  removeTemporaryDirectory(path: string): Promise<void>;
}

export const nodeRepositoryFileSystem: RepositoryFileSystemPort = {
  ...nodePathInspection,
  profile: process.platform === "win32" ? "windows-local" : "unsupported",
  mkdir: async (path) => mkdir(path),
  writeNewFile: async (path, bytes) => writeFile(path, bytes, { flag: "wx" }),
  publishNewDirectory: rename,
  removeTemporaryDirectory: async (path) => rm(path, { recursive: true, force: true }),
};

export interface InitRequest {
  start_directory: string;
  operation_id: string;
}

export interface InitResult {
  repository_root: string;
  repository_id: string;
  already_initialized: boolean;
}

export interface InitPorts {
  fs: RepositoryFileSystemPort;
  schemas: SchemaRegistry;
  createRepositoryId(): string;
  createTemporaryId(): string;
  now(): string;
  displayRepositoryRoot(root: string): void | Promise<void>;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function sameFile(left: PathInfo, right: PathInfo): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function isLinkOrReparse(info: PathInfo): boolean {
  return info.isSymbolicLink() || info.isReparsePoint();
}

async function readPlainFile(path: string, fs: RepositoryFileSystemPort): Promise<Uint8Array> {
  const before = await fs.lstat(path);
  if (!before.isFile() || isLinkOrReparse(before)) throw new Error("unsafe file type");
  const handle = await fs.openRead(path);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || isLinkOrReparse(opened) || !sameFile(before, opened)) {
      throw new Error("file changed while opening");
    }
    return await handle.readAll();
  } finally {
    await handle.close();
  }
}

function parseManifest(bytes: Uint8Array, schemas: SchemaRegistry):
  | { ok: true; manifest: Manifest }
  | { ok: false; unsupported: boolean } {
  try {
    const value = parseGovernedJson(bytes);
    const validation = schemas.validate("manifest", value);
    if (!validation.ok) return { ok: false, unsupported: validation.code === "CASE_E_UNSUPPORTED_VERSION" };
    return { ok: true, manifest: value as unknown as Manifest };
  } catch {
    return { ok: false, unsupported: false };
  }
}

async function inspectExistingNamespace(
  namespace: string,
  ports: InitPorts,
): Promise<{ kind: "absent" } | { kind: "compatible"; manifest: Manifest } | { kind: "unsupported" } | { kind: "collision" }> {
  let namespaceInfo: PathInfo;
  try {
    namespaceInfo = await ports.fs.lstat(namespace);
  } catch (error) {
    if (isMissing(error)) return { kind: "absent" };
    return { kind: "collision" };
  }
  if (!namespaceInfo.isDirectory() || isLinkOrReparse(namespaceInfo)) return { kind: "collision" };

  try {
    const entries = await ports.fs.listDirectory(namespace);
    const names = entries.map(({ name }) => name).sort();
    if (names.length !== 3 || names[0] !== "dossiers" || names[1] !== "locks" || names[2] !== "manifest.json") {
      return { kind: "collision" };
    }
    const dossiers = await ports.fs.lstat(join(namespace, "dossiers"));
    const locks = await ports.fs.lstat(join(namespace, "locks"));
    if (!dossiers.isDirectory() || isLinkOrReparse(dossiers) || !locks.isDirectory() || isLinkOrReparse(locks)) {
      return { kind: "collision" };
    }
    const parsed = parseManifest(await readPlainFile(join(namespace, "manifest.json"), ports.fs), ports.schemas);
    if (!parsed.ok) return { kind: parsed.unsupported ? "unsupported" : "collision" };
    return { kind: "compatible", manifest: parsed.manifest };
  } catch {
    return { kind: "collision" };
  }
}

function initSuccess(root: string, manifest: Manifest, alreadyInitialized: boolean): ResultEnvelope<InitResult> {
  return success("init", alreadyInitialized ? "Repository already initialized" : "Repository initialized", {
    repository_root: root,
    repository_id: manifest.repository_id,
    already_initialized: alreadyInitialized,
  });
}

/** Initialize a repository by publishing one complete, validated namespace directory. */
export async function initRepository(
  request: InitRequest,
  ports: InitPorts,
): Promise<ResultEnvelope<InitResult>> {
  if (request.operation_id.length === 0 || request.operation_id.includes("\0")) {
    return failure("init", "CASE_E_USAGE", "A valid operation ID is required");
  }

  let root: string;
  try {
    root = await discoverRepositoryRoot(request.start_directory, ports.fs);
  } catch {
    return failure("init", "CASE_E_NOT_INITIALIZED", "No owning repository was found");
  }
  try {
    await ports.displayRepositoryRoot(root);
  } catch {
    return failure("init", "CASE_E_INTERNAL", "The repository root could not be displayed");
  }

  const namespace = join(root, ".case-agent");
  const existing = await inspectExistingNamespace(namespace, ports);
  if (existing.kind === "compatible") return initSuccess(root, existing.manifest, true);
  if (existing.kind === "unsupported") {
    return failure("init", "CASE_E_UNSUPPORTED_VERSION", "The existing namespace uses an unsupported protocol major");
  }
  if (existing.kind === "collision") {
    return failure("init", "CASE_E_NAMESPACE_COLLISION", "The existing .case-agent namespace is not owned and compatible");
  }
  if (ports.fs.profile === "unsupported") {
    return failure("init", "CASE_E_INTERNAL", "Atomic directory publication is unsupported on this filesystem profile");
  }

  let manifest: Manifest;
  try {
    manifest = {
      protocol: "case-agent",
      protocol_version: "0.1.0-preview",
      schema_dialect: "https://json-schema.org/draft/2020-12/schema",
      repository_id: ports.createRepositoryId(),
      created_at: ports.now(),
    };
    if (!ports.schemas.validate("manifest", manifest).ok) {
      return failure("init", "CASE_E_INTERNAL", "Generated manifest validation failed");
    }
  } catch {
    return failure("init", "CASE_E_INTERNAL", "Generated manifest validation failed");
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");
  if (!parseManifest(manifestBytes, ports.schemas).ok) {
    return failure("init", "CASE_E_INTERNAL", "Generated manifest round-trip validation failed");
  }

  const temporaryId = ports.createTemporaryId();
  if (!/^[A-Za-z0-9_-]+$/.test(temporaryId)) {
    return failure("init", "CASE_E_INTERNAL", "The temporary directory identifier is unsafe");
  }
  const temporary = join(root, `.case-agent.tmp-${temporaryId}`);
  let ownsTemporary = false;
  try {
    await ports.fs.mkdir(temporary);
    ownsTemporary = true;
    await ports.fs.mkdir(join(temporary, "dossiers"));
    await ports.fs.mkdir(join(temporary, "locks"));
    await ports.fs.writeNewFile(join(temporary, "manifest.json"), manifestBytes);
    const staged = parseManifest(await readPlainFile(join(temporary, "manifest.json"), ports.fs), ports.schemas);
    if (!staged.ok) throw new Error("staged manifest validation failed");
    await ports.fs.publishNewDirectory(temporary, namespace);
    ownsTemporary = false;
    return initSuccess(root, staged.manifest, false);
  } catch {
    if (ownsTemporary) {
      try { await ports.fs.removeTemporaryDirectory(temporary); } catch { /* best-effort cleanup of owned staging only */ }
    }
    const raced = await inspectExistingNamespace(namespace, ports);
    if (raced.kind === "compatible") return initSuccess(root, raced.manifest, true);
    if (raced.kind === "unsupported") {
      return failure("init", "CASE_E_UNSUPPORTED_VERSION", "The existing namespace uses an unsupported protocol major");
    }
    if (raced.kind === "collision") {
      return failure("init", "CASE_E_NAMESPACE_COLLISION", "The .case-agent namespace collided during publication");
    }
    return failure("init", "CASE_E_INTERNAL", "Repository initialization could not be published");
  }
}
