import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseGovernedJson } from "../protocol/json.js";
import { failure, success, type ResultEnvelope } from "../protocol/result.js";
import type { SchemaRegistry } from "../protocol/schema-registry.js";
import type { Manifest } from "../protocol/types.js";
import {
  discoverRepositoryRoot,
  nodeGitDiscovery,
  nodePathInspection,
  type GitDiscoveryPort,
  type PathInspectionPort,
  type PathInfo,
} from "../storage/paths.js";

export interface RepositoryFileSystemPort extends PathInspectionPort {
  classifyInitializationTarget(root: string): Promise<InitializationTargetClassification>;
  createDirectoryExclusive(path: string): Promise<void>;
  writeNewFile(path: string, bytes: Uint8Array): Promise<void>;
  removeOwnedNamespace(path: string): Promise<void>;
}

export type InitializationTargetClassification =
  | { readonly supported: true; readonly profile: string }
  | { readonly supported: false; readonly reason: "unclassified" | "unc" | "reparse-uncertain" | "non-local" };

export const nodeRepositoryFileSystem: RepositoryFileSystemPort = {
  ...nodePathInspection,
  classifyInitializationTarget: async () => ({ supported: false, reason: "unclassified" }),
  createDirectoryExclusive: async (path) => mkdir(path),
  writeNewFile: async (path, bytes) => writeFile(path, bytes, { flag: "wx" }),
  removeOwnedNamespace: async (path) => rm(path, { recursive: true, force: true }),
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
  git?: GitDiscoveryPort;
  schemas: SchemaRegistry;
  createRepositoryId(): string;
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
  root: string,
  ports: InitPorts,
): Promise<{ kind: "absent" } | { kind: "compatible"; manifest: Manifest } | { kind: "unsupported" } | { kind: "collision" }> {
  const namespace = join(root, ".case-agent");
  try {
    const rootEntries = await ports.fs.listDirectory(root);
    const namespaceAliases = rootEntries.filter(({ name }) => name.toLowerCase() === ".case-agent");
    if (namespaceAliases.length > 1 || (namespaceAliases.length === 1 && namespaceAliases[0]!.name !== ".case-agent")) {
      return { kind: "collision" };
    }
    if (namespaceAliases.length === 0) {
      try {
        await ports.fs.lstat(namespace);
        return { kind: "collision" };
      } catch (error) {
        return isMissing(error) ? { kind: "absent" } : { kind: "collision" };
      }
    }
  } catch {
    return { kind: "collision" };
  }

  let namespaceInfo: PathInfo;
  try {
    namespaceInfo = await ports.fs.lstat(namespace);
  } catch (error) {
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

/** Initialize only inside an exclusively created namespace; the manifest is the completion marker. */
export async function initRepository(
  request: InitRequest,
  ports: InitPorts,
): Promise<ResultEnvelope<InitResult>> {
  if (request.operation_id.length === 0 || request.operation_id.includes("\0")) {
    return failure("init", "CASE_E_USAGE", "A valid operation ID is required");
  }

  let root: string;
  try {
    root = await discoverRepositoryRoot(request.start_directory, ports.fs, ports.git ?? nodeGitDiscovery);
  } catch {
    return failure("init", "CASE_E_NOT_INITIALIZED", "No owning repository was found");
  }
  try {
    await ports.displayRepositoryRoot(root);
  } catch {
    return failure("init", "CASE_E_INTERNAL", "The repository root could not be displayed");
  }

  const namespace = join(root, ".case-agent");
  let classification: InitializationTargetClassification;
  try {
    classification = await ports.fs.classifyInitializationTarget(root);
  } catch {
    return failure("init", "CASE_E_INTERNAL", "The initialization target could not be classified safely");
  }
  if (!classification.supported) {
    return failure("init", "CASE_E_UNSUPPORTED_PROFILE", "The initialization target is not a proven supported local filesystem profile");
  }
  const existing = await inspectExistingNamespace(root, ports);
  if (existing.kind === "compatible") return initSuccess(root, existing.manifest, true);
  if (existing.kind === "unsupported") {
    return failure("init", "CASE_E_UNSUPPORTED_VERSION", "The existing namespace uses an unsupported protocol major");
  }
  if (existing.kind === "collision") {
    return failure("init", "CASE_E_NAMESPACE_COLLISION", "The existing .case-agent namespace is not owned and compatible");
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

  let ownsNamespace = false;
  try {
    await ports.fs.createDirectoryExclusive(namespace);
    ownsNamespace = true;
    await ports.fs.createDirectoryExclusive(join(namespace, "dossiers"));
    await ports.fs.createDirectoryExclusive(join(namespace, "locks"));
    await ports.fs.writeNewFile(join(namespace, "manifest.json"), manifestBytes);
    const completed = parseManifest(await readPlainFile(join(namespace, "manifest.json"), ports.fs), ports.schemas);
    if (!completed.ok) throw new Error("completion manifest validation failed");
    ownsNamespace = false;
    return initSuccess(root, completed.manifest, false);
  } catch {
    if (ownsNamespace) {
      try { await ports.fs.removeOwnedNamespace(namespace); } catch { /* partial namespace remains a future collision */ }
    }
    const raced = await inspectExistingNamespace(root, ports);
    if (raced.kind === "compatible") return initSuccess(root, raced.manifest, true);
    if (raced.kind === "unsupported") {
      return failure("init", "CASE_E_UNSUPPORTED_VERSION", "The existing namespace uses an unsupported protocol major");
    }
    if (raced.kind === "collision") {
      return failure("init", "CASE_E_NAMESPACE_COLLISION", "The .case-agent namespace is partial or collided during initialization");
    }
    return failure("init", "CASE_E_INTERNAL", "Repository initialization could not be completed");
  }
}
