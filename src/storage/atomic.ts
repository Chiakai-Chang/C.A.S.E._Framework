import { open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { digestProjection } from "../protocol/canonical.js";
import { parseGovernedJson, type JsonValue } from "../protocol/json.js";
import { projectState } from "../protocol/projections.js";
import { failure, success, type FailureResultEnvelope, type ResultEnvelope } from "../protocol/result.js";
import type { SchemaKind } from "../protocol/schema-registry.js";
import type { DossierSnapshot } from "../protocol/types.js";
import {
  guardIsOwned,
  releaseGuard,
  type EnvelopeKind,
  type WriterGuard,
} from "./guard.js";

export type AtomicPublicationProfile =
  | {
      readonly supported: true;
      readonly profile: string;
      readonly crash_safety: "process-crash";
      readonly physical_durability: boolean;
    }
  | {
      readonly supported: false;
      readonly profile: string;
      readonly reason: "windows-node-primitive-unproven" | "unclassified-filesystem";
    };

export interface PosixLocalAtomicClassification {
  readonly supported: true;
  readonly profile: string;
}

/** Paths are repository-relative; an adapter must confine every operation to its configured root. */
export interface AtomicFsPort {
  readonly profile: AtomicPublicationProfile;
  readFile(path: string): Promise<Uint8Array>;
  createOnce(path: string, bytes: Uint8Array): Promise<void>;
  flushFile(path: string): Promise<void>;
  replaceCurrent(tempPath: string, targetPath: string): Promise<void>;
  remove(path: string): Promise<void>;
  quarantineOnce(sourcePath: string, quarantinePath: string): Promise<void>;
}

function confined(root: string, path: string): string {
  if (isAbsolute(path) || path.includes("\0")) throw new Error("unsafe atomic path");
  const configuredRoot = resolve(root);
  const candidate = resolve(configuredRoot, path);
  const fromRoot = relative(configuredRoot, candidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("atomic path escapes repository root");
  }
  return candidate;
}

/**
 * Node 24/libuv uses MoveFileExW(..., MOVEFILE_REPLACE_EXISTING) for fs.rename on
 * Windows, not ReplaceFileW. This adapter therefore withholds Windows support.
 * On POSIX it uses same-directory rename and claims process-crash atomicity only,
 * not directory-entry fsync or physical-power-loss durability.
 */
export function nodeAtomicFsPort(
  repositoryRoot: string,
  classification?: PosixLocalAtomicClassification,
): AtomicFsPort {
  const path = (relativePath: string): string => confined(repositoryRoot, relativePath);
  const profile: AtomicPublicationProfile = process.platform === "win32"
    ? { supported: false, profile: "node-libuv-movefileexw", reason: "windows-node-primitive-unproven" }
    : classification === undefined
      ? { supported: false, profile: "node-libuv-posix-rename", reason: "unclassified-filesystem" }
      : {
          supported: true,
          profile: `node-libuv-posix-rename:${classification.profile}`,
          crash_safety: "process-crash",
          physical_durability: false,
        };
  return {
    profile,
    readFile: async (relativePath) => readFile(path(relativePath)),
    async createOnce(relativePath, bytes) {
      const handle = await open(path(relativePath), "wx");
      try { await handle.writeFile(bytes); } finally { await handle.close(); }
    },
    async flushFile(relativePath) {
      const handle = await open(path(relativePath), "r+");
      try { await handle.sync(); } finally { await handle.close(); }
    },
    async replaceCurrent(tempPath, targetPath) {
      const temp = path(tempPath);
      const target = path(targetPath);
      if (dirname(temp) !== dirname(target)) throw new Error("atomic replacement must stay in one directory");
      await rename(temp, target);
    },
    remove: async (relativePath) => unlink(path(relativePath)),
    async quarantineOnce(sourcePath, quarantinePath) {
      try {
        await readFile(path(quarantinePath));
        const error = new Error("quarantine exists") as NodeJS.ErrnoException;
        error.code = "EEXIST";
        throw error;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await rename(path(sourcePath), path(quarantinePath));
    },
  };
}

export interface MutationProduct<T> {
  readonly snapshot: DossierSnapshot;
  readonly data: T;
}

export interface ImmutableEnvelopePlan<E extends JsonValue, T> {
  readonly kind: EnvelopeKind;
  readonly envelope_id: string;
  readonly input_projection: JsonValue;
  create(basis: DossierSnapshot): E;
  projectInput(envelope: E): JsonValue;
  buildSnapshot(basis: DossierSnapshot, envelope: E): MutationProduct<T> | FailureResultEnvelope;
  recover?(committed: DossierSnapshot, envelope: E): T;
}

function mutationFailure(code: FailureResultEnvelope["code"], message: string): FailureResultEnvelope {
  return failure("mutation", code, message);
}

function serialize(value: JsonValue): Uint8Array {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

function parseDossier(bytes: Uint8Array, guard: WriterGuard): DossierSnapshot | null {
  try {
    const value = parseGovernedJson(bytes);
    if (!guard.ports.schemas.validate("dossier", value).ok) return null;
    return value as unknown as DossierSnapshot;
  } catch {
    return null;
  }
}

function isValidNextSnapshot(guard: WriterGuard, snapshot: DossierSnapshot): boolean {
  const basis = guard.basis;
  if (basis === null || snapshot.dossier_id !== basis.dossier_id) return false;
  let expectedRevision: string;
  try { expectedRevision = (BigInt(basis.state_revision) + 1n).toString(); } catch { return false; }
  const operation = snapshot.last_operation;
  if (snapshot.state_revision !== expectedRevision
    || operation === null
    || operation.operation_id !== guard.precondition.operation_id
    || operation.input_digest !== guard.precondition.input_digest
    || operation.basis_revision !== guard.precondition.expected_revision
    || operation.resulting_revision !== snapshot.state_revision) return false;
  try {
    return guard.ports.schemas.validate("dossier", snapshot).ok
      && snapshot.state_digest === digestProjection(projectState(snapshot));
  } catch {
    return false;
  }
}

async function recoveryIsAbsent(guard: WriterGuard): Promise<boolean> {
  if (guard.recovery) return true;
  try {
    await guard.ports.fs.readFile(guard.recoveryPath);
    return false;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
  }
}

async function finishFailure(
  guard: WriterGuard,
  code: FailureResultEnvelope["code"],
  message: string,
  release: boolean,
): Promise<FailureResultEnvelope> {
  if (!release) return mutationFailure(code, message);
  return await releaseGuard(guard)
    ? mutationFailure(code, message)
    : mutationFailure("CASE_E_RECOVERY_REQUIRED", "The mutation failed and its guard could not be released safely");
}

async function publishBuiltSnapshot<T>(guard: WriterGuard, product: MutationProduct<T>): Promise<ResultEnvelope<T>> {
  if (!isValidNextSnapshot(guard, product.snapshot)) {
    return finishFailure(guard, "CASE_E_INTERNAL", "The mutation builder produced an invalid governed snapshot", true);
  }
  let tempId: string;
  try {
    tempId = guard.ports.ids.tempIdFor(guard.guardId!);
    if (!/^[A-Za-z0-9._-]+$/u.test(tempId) || tempId === "." || tempId === "..") throw new Error("unsafe temp id");
  } catch {
    return finishFailure(guard, "CASE_E_INTERNAL", "A safe same-directory temporary name could not be derived", true);
  }
  const dossierDirectory = join(".case-agent", "dossiers", guard.precondition.dossier_id);
  const targetPath = join(dossierDirectory, "dossier.json");
  const tempPath = join(dossierDirectory, `.dossier.json.tmp-${tempId}`);
  const bytes = serialize(product.snapshot as unknown as JsonValue);

  try {
    await guard.ports.fs.createOnce(tempPath, bytes);
    await guard.ports.fs.flushFile(tempPath);
    const persisted = await guard.ports.fs.readFile(tempPath);
    const parsed = parseDossier(persisted, guard);
    if (!Buffer.from(persisted).equals(Buffer.from(bytes)) || parsed === null
      || parsed.state_digest !== product.snapshot.state_digest) {
      return mutationFailure("CASE_E_RECOVERY_REQUIRED", "The temporary snapshot could not be verified exactly");
    }
  } catch {
    return mutationFailure("CASE_E_INTERNAL", "Snapshot staging was interrupted; explicit recovery may be required");
  }

  try {
    await guard.ports.fs.replaceCurrent(tempPath, targetPath);
  } catch {
    let targetIsRecognized = false;
    try {
      const observed = await guard.store.loadDossier(guard.precondition.dossier_id);
      targetIsRecognized = (observed.state_revision === product.snapshot.state_revision
          && observed.state_digest === product.snapshot.state_digest)
        || (observed.state_revision === guard.basis?.state_revision
          && observed.state_digest === guard.basis.state_digest);
    } catch { /* retain guard and fail closed */ }
    return mutationFailure("CASE_E_RECOVERY_REQUIRED", targetIsRecognized
      ? "Snapshot replacement had an indeterminate outcome"
      : "Snapshot replacement failed and the target could not be verified");
  }

  try {
    const published = await guard.store.loadDossier(guard.precondition.dossier_id);
    if (published.state_revision !== product.snapshot.state_revision
      || published.state_digest !== product.snapshot.state_digest
      || published.last_operation?.operation_id !== guard.precondition.operation_id) {
      return mutationFailure("CASE_E_RECOVERY_REQUIRED", "The published snapshot could not be verified exactly");
    }
  } catch {
    return mutationFailure("CASE_E_RECOVERY_REQUIRED", "The published snapshot could not be reopened safely");
  }

  if (!await releaseGuard(guard)) {
    return mutationFailure("CASE_E_RECOVERY_REQUIRED", "The snapshot was published but its guard could not be released safely");
  }
  return success("mutation", "Governed snapshot mutation committed", product.data);
}

/** Commit one complete snapshot under an already acquired writer guard. */
export async function commitSnapshotMutation<T>(
  guard: WriterGuard,
  build: (basis: DossierSnapshot) => MutationProduct<T> | FailureResultEnvelope,
  recover: (committed: DossierSnapshot) => T = (committed) => committed as unknown as T,
): Promise<ResultEnvelope<T>> {
  try {
    if (guard.mode === "failed") return guard.acquisitionFailure ?? mutationFailure("CASE_E_INTERNAL", "Writer acquisition failed");
    if (guard.basis === null) return mutationFailure("CASE_E_INTERNAL", "The writer guard has no validated basis");
    if (!await guardIsOwned(guard)) return mutationFailure("CASE_E_RECOVERY_REQUIRED", "The writer guard is no longer owned");
    if (!await recoveryIsAbsent(guard)) {
      return finishFailure(guard, "CASE_E_BUSY", "Dossier recovery started before publication", true);
    }
    if (guard.mode === "retry") {
      let data: T;
      try { data = recover(guard.basis); } catch {
        return finishFailure(guard, "CASE_E_INTERNAL", "The prior mutation result could not be reconstructed safely", true);
      }
      if (!await releaseGuard(guard)) {
        return mutationFailure("CASE_E_RECOVERY_REQUIRED", "The immediate retry was recognized but its guard could not be released");
      }
      return success("mutation", "Identical operation already committed", data);
    }
    let product: MutationProduct<T> | FailureResultEnvelope;
    try { product = build(guard.basis); } catch {
      return finishFailure(guard, "CASE_E_INTERNAL", "The mutation builder failed unexpectedly", true);
    }
    if ("ok" in product) return finishFailure(guard, product.code, product.message, true);
    return publishBuiltSnapshot(guard, product);
  } catch {
    return mutationFailure("CASE_E_INTERNAL", "The governed mutation failed unexpectedly");
  }
}

function envelopeSchema(kind: EnvelopeKind): SchemaKind {
  return kind;
}

function envelopeDirectory(kind: EnvelopeKind): string {
  return `${kind}s`;
}

function validEnvelopeId(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/u.test(value) && value !== "." && value !== "..";
}

function envelopeIsBound(
  guard: WriterGuard,
  kind: EnvelopeKind,
  expectedId: string,
  envelope: JsonValue,
): boolean {
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) return false;
  const idField = `${kind}_id`;
  if (envelope[idField] !== expectedId
    || envelope.dossier_id !== guard.precondition.dossier_id
    || envelope.created_operation_id !== guard.precondition.operation_id) return false;
  if (kind === "handoff" || kind === "submission") {
    let publishedRevision: string;
    try { publishedRevision = (BigInt(guard.precondition.expected_revision) + 1n).toString(); } catch { return false; }
    return envelope.basis_revision === guard.precondition.expected_revision
      && envelope.basis_state_digest === guard.precondition.expected_state_digest
      && envelope.published_revision === publishedRevision;
  }
  return true;
}

/** Create or verify one immutable envelope before publishing its snapshot pointer. */
export async function commitEnvelopeMutation<E extends JsonValue, T>(
  guard: WriterGuard,
  plan: ImmutableEnvelopePlan<E, T>,
): Promise<ResultEnvelope<T>> {
  try {
    if (guard.mode === "failed") return guard.acquisitionFailure ?? mutationFailure("CASE_E_INTERNAL", "Writer acquisition failed");
    if (guard.basis === null) return mutationFailure("CASE_E_INTERNAL", "The writer guard has no validated basis");
    if (!await guardIsOwned(guard) || !await recoveryIsAbsent(guard)) {
      return mutationFailure("CASE_E_RECOVERY_REQUIRED", "The writer guard is not exclusively owned");
    }
    const expectedId = guard.ports.ids.envelopeIdFor(plan.kind, guard.precondition.operation_id);
    if (!validEnvelopeId(plan.envelope_id) || plan.envelope_id !== expectedId
      || digestProjection(plan.input_projection) !== guard.precondition.input_digest) {
      return finishFailure(guard, "CASE_E_INTERNAL", "The immutable envelope plan is not bound to the operation", true);
    }
    const path = join(".case-agent", "dossiers", guard.precondition.dossier_id,
      envelopeDirectory(plan.kind), `${plan.envelope_id}.json`);
    let envelope: E;
    let existingBytes: Uint8Array | null = null;
    try { existingBytes = await guard.ports.fs.readFile(path); } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) {
        return finishFailure(guard, "CASE_E_RECOVERY_REQUIRED", "The immutable envelope path could not be inspected", false);
      }
    }
    if (existingBytes === null && guard.mode === "retry") {
      return finishFailure(guard, "CASE_E_INVARIANT", "The committed operation's immutable envelope is missing", true);
    }
    if (existingBytes !== null) {
      try {
        const parsed = parseGovernedJson(existingBytes) as E;
        if (!guard.ports.schemas.validate(envelopeSchema(plan.kind), parsed).ok
          || !envelopeIsBound(guard, plan.kind, plan.envelope_id, parsed)
          || digestProjection(plan.projectInput(parsed)) !== guard.precondition.input_digest) {
          return finishFailure(guard, "CASE_E_CONFLICT", "The existing immutable envelope conflicts with this operation", true);
        }
        envelope = parsed;
      } catch {
        return finishFailure(guard, "CASE_E_CONFLICT", "The existing immutable envelope is invalid or conflicting", true);
      }
    } else {
      try {
        envelope = plan.create(guard.basis);
        if (!guard.ports.schemas.validate(envelopeSchema(plan.kind), envelope).ok
          || !envelopeIsBound(guard, plan.kind, plan.envelope_id, envelope)
          || digestProjection(plan.projectInput(envelope)) !== guard.precondition.input_digest) {
          return finishFailure(guard, "CASE_E_INTERNAL", "The generated immutable envelope is invalid", true);
        }
        const bytes = serialize(envelope);
        await guard.ports.fs.createOnce(path, bytes);
        await guard.ports.fs.flushFile(path);
        const persisted = await guard.ports.fs.readFile(path);
        if (!Buffer.from(persisted).equals(Buffer.from(bytes))) {
          return mutationFailure("CASE_E_RECOVERY_REQUIRED", "The immutable envelope did not persist exactly");
        }
      } catch {
        return mutationFailure("CASE_E_INTERNAL", "Immutable envelope publication was interrupted");
      }
    }
    if (guard.mode === "retry") {
      let data: T;
      try { data = plan.recover === undefined ? guard.basis as unknown as T : plan.recover(guard.basis, envelope); } catch {
        return finishFailure(guard, "CASE_E_INTERNAL", "The prior envelope result could not be reconstructed safely", true);
      }
      if (!await releaseGuard(guard)) return mutationFailure("CASE_E_RECOVERY_REQUIRED", "The retry guard could not be released");
      return success("mutation", "Identical operation already committed", data);
    }
    let product: MutationProduct<T> | FailureResultEnvelope;
    try { product = plan.buildSnapshot(guard.basis, envelope); } catch {
      return finishFailure(guard, "CASE_E_INTERNAL", "The envelope snapshot builder failed unexpectedly", true);
    }
    if ("ok" in product) return finishFailure(guard, product.code, product.message, true);
    return publishBuiltSnapshot(guard, product);
  } catch {
    return mutationFailure("CASE_E_INTERNAL", "The governed envelope mutation failed unexpectedly");
  }
}
