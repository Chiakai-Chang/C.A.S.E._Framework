import { join } from "node:path";
import { digestProjection } from "../protocol/canonical.js";
import { parseGovernedJson, type JsonValue } from "../protocol/json.js";
import { projectState } from "../protocol/projections.js";
import { failure, success, type FailureResultEnvelope, type ResultEnvelope } from "../protocol/result.js";
import type { SchemaRegistry } from "../protocol/schema-registry.js";
import {
  isDigest,
  isRevision,
  revision,
  type Digest,
  type DossierSnapshot,
  type MutationPrecondition,
  type Revision,
} from "../protocol/types.js";
import type { AtomicFsPort } from "./atomic.js";
import { CaseStore } from "./store.js";

export interface ProcessIdentity {
  readonly profile: string;
  readonly pid: string;
  readonly process_started_at: string;
}

export interface ProcessIdentityPort {
  current(): Promise<ProcessIdentity>;
  verifyTerminated(identity: ProcessIdentity): Promise<"terminated" | "live" | "unknown">;
}

export interface ClockPort {
  now(): string;
  isPossiblyStale(createdAt: string): boolean;
}

export type EnvelopeKind = "handoff" | "submission" | "decision";

export interface IdPort {
  createGuardId(): string;
  tempIdFor(guardId: string): string;
  envelopeIdFor(kind: EnvelopeKind, operationId: string): string;
}

export interface MutationPorts {
  readonly fs: AtomicFsPort;
  readonly schemas: Pick<SchemaRegistry, "validate">;
  readonly processIdentity: ProcessIdentityPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
}

export interface GovernedMutationPrecondition extends MutationPrecondition {
  readonly input_digest: Digest;
}

interface GuardRecord {
  readonly kind: "writer" | "recovery";
  readonly guard_id: string;
  readonly dossier_id: string;
  readonly basis_revision: string;
  readonly basis_state_digest: string;
  readonly operation_id: string;
  readonly input_digest: string;
  readonly process_identity: ProcessIdentity;
  readonly created_at: string;
}

export interface WriterGuard {
  readonly store: CaseStore;
  readonly ports: MutationPorts;
  readonly precondition: GovernedMutationPrecondition;
  readonly writerPath: string;
  readonly recoveryPath: string;
  readonly lockPath: string | null;
  readonly lockBytes: Uint8Array | null;
  readonly guardId: string | null;
  readonly basis: DossierSnapshot | null;
  readonly mode: "ready" | "retry" | "failed";
  readonly acquisitionFailure: FailureResultEnvelope | null;
  readonly recovery: boolean;
}

export interface RecoverWriterGuardRequest {
  readonly dossier_id: string;
  readonly operation_id: string;
  readonly expected_revision: Revision;
  readonly expected_state_digest: Digest;
  readonly confirmation: RecoveryConfirmationPort;
}

export interface RecoveryConfirmationView {
  readonly dossier_id: string;
  readonly guard_id: string;
  readonly created_at: string;
  readonly process_identity: ProcessIdentity;
}

export interface RecoveryConfirmationPort {
  readonly interactive: boolean;
  confirmRecovery(view: RecoveryConfirmationView): Promise<boolean>;
}

export interface RecoverWriterGuardResult {
  readonly snapshot: DossierSnapshot;
  readonly quarantined_lock: string;
}

function mutationFailure(code: FailureResultEnvelope["code"], message: string): FailureResultEnvelope {
  return failure("mutation", code, message);
}

function failedGuard(
  store: CaseStore,
  ports: MutationPorts,
  precondition: GovernedMutationPrecondition,
  writerPath: string,
  recoveryPath: string,
  result: FailureResultEnvelope,
): WriterGuard {
  return {
    store,
    ports,
    precondition,
    writerPath,
    recoveryPath,
    lockPath: null,
    lockBytes: null,
    guardId: null,
    basis: null,
    mode: "failed",
    acquisitionFailure: result,
    recovery: false,
  };
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function validSegment(value: string): boolean {
  return value.length > 0
    && value !== "."
    && value !== ".."
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes("\0")
    && !/[<>:"|?*]/u.test(value);
}

function validOpaque(value: string): boolean {
  return value.length > 0 && !value.includes("\0");
}

function validTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value)
    && Number.isFinite(Date.parse(value));
}

function record(value: JsonValue): Record<string, JsonValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function exactKeys(value: Record<string, JsonValue>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && expected.slice().sort().every((key, index) => actual[index] === key);
}

export function parseGuardRecord(bytes: Uint8Array): GuardRecord | null {
  try {
    const parsed = record(parseGovernedJson(bytes));
    if (parsed === null || !exactKeys(parsed, [
      "basis_revision",
      "basis_state_digest",
      "created_at",
      "dossier_id",
      "guard_id",
      "input_digest",
      "kind",
      "operation_id",
      "process_identity",
    ])) return null;
    const identity = record(parsed.process_identity!);
    if (identity === null || !exactKeys(identity, ["pid", "process_started_at", "profile"])) return null;
    if ((parsed.kind !== "writer" && parsed.kind !== "recovery")
      || typeof parsed.guard_id !== "string" || !validSegment(parsed.guard_id)
      || typeof parsed.dossier_id !== "string" || !validSegment(parsed.dossier_id)
      || typeof parsed.basis_revision !== "string" || !isRevision(parsed.basis_revision)
      || typeof parsed.basis_state_digest !== "string" || !isDigest(parsed.basis_state_digest)
      || typeof parsed.operation_id !== "string" || !validOpaque(parsed.operation_id)
      || typeof parsed.input_digest !== "string" || !isDigest(parsed.input_digest)
      || typeof parsed.created_at !== "string" || !validTimestamp(parsed.created_at)
      || typeof identity.profile !== "string" || identity.profile.length === 0
      || typeof identity.pid !== "string" || identity.pid.length === 0
      || typeof identity.process_started_at !== "string" || !validTimestamp(identity.process_started_at)) return null;
    return {
      kind: parsed.kind,
      guard_id: parsed.guard_id,
      dossier_id: parsed.dossier_id,
      basis_revision: parsed.basis_revision,
      basis_state_digest: parsed.basis_state_digest,
      operation_id: parsed.operation_id,
      input_digest: parsed.input_digest,
      process_identity: {
        profile: identity.profile,
        pid: identity.pid,
        process_started_at: identity.process_started_at,
      },
      created_at: parsed.created_at,
    };
  } catch {
    return null;
  }
}

function guardBytes(recordValue: GuardRecord): Uint8Array {
  return Buffer.from(`${JSON.stringify(recordValue)}\n`, "utf8");
}

function snapshotMetadataIsValid(snapshot: DossierSnapshot): boolean {
  try {
    if (snapshot.state_digest !== digestProjection(projectState(snapshot))) return false;
    if (snapshot.last_operation === null) return snapshot.state_revision === "0";
    return snapshot.last_operation.resulting_revision === snapshot.state_revision
      && BigInt(snapshot.last_operation.basis_revision) + 1n === BigInt(snapshot.last_operation.resulting_revision);
  } catch {
    return false;
  }
}

async function readOptional(fs: AtomicFsPort, path: string): Promise<Uint8Array | null> {
  try {
    return await fs.readFile(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function createGuard(
  store: CaseStore,
  precondition: GovernedMutationPrecondition,
  ports: MutationPorts,
): Promise<WriterGuard> {
  const writerPath = join(".case-agent", "locks", `${precondition.dossier_id}.lock`);
  const recoveryPath = join(".case-agent", "locks", `${precondition.dossier_id}.recovery.lock`);
  const fail = (code: FailureResultEnvelope["code"], message: string): WriterGuard =>
    failedGuard(store, ports, precondition, writerPath, recoveryPath, mutationFailure(code, message));

  if (!ports.fs.profile.supported) {
    return fail("CASE_E_UNSUPPORTED_PROFILE", "Atomic publication is unavailable for this filesystem profile");
  }
  if (!validSegment(precondition.dossier_id)
    || !validOpaque(precondition.operation_id)
    || !isRevision(precondition.expected_revision)
    || !isDigest(precondition.expected_state_digest)
    || !isDigest(precondition.input_digest)) {
    return fail("CASE_E_USAGE", "The governed mutation address or precondition is invalid");
  }

  try {
    if (await readOptional(ports.fs, recoveryPath) !== null) {
      return fail("CASE_E_BUSY", "Dossier recovery is currently in progress");
    }
  } catch {
    return fail("CASE_E_RECOVERY_REQUIRED", "The recovery guard could not be inspected safely");
  }

  let guardId: string;
  let createdAt: string;
  let identity: ProcessIdentity;
  try {
    guardId = ports.ids.createGuardId();
    createdAt = ports.clock.now();
    identity = await ports.processIdentity.current();
    if (!validSegment(guardId) || !validTimestamp(createdAt)
      || identity.profile.length === 0 || identity.pid.length === 0 || !validTimestamp(identity.process_started_at)) {
      return fail("CASE_E_INTERNAL", "The writer identity could not be recorded safely");
    }
  } catch {
    return fail("CASE_E_INTERNAL", "The writer identity could not be recorded safely");
  }

  const recordValue: GuardRecord = {
    kind: "writer",
    guard_id: guardId,
    dossier_id: precondition.dossier_id,
    basis_revision: precondition.expected_revision,
    basis_state_digest: precondition.expected_state_digest,
    operation_id: precondition.operation_id,
    input_digest: precondition.input_digest,
    process_identity: identity,
    created_at: createdAt,
  };
  const bytes = guardBytes(recordValue);
  try {
    await ports.fs.createOnce(writerPath, bytes);
  } catch (error) {
    if (!isExists(error)) return fail("CASE_E_INTERNAL", "The writer guard could not be created");
    try {
      const existingBytes = await readOptional(ports.fs, writerPath);
      const existing = existingBytes === null ? null : parseGuardRecord(existingBytes);
      if (existing === null || existing.kind !== "writer" || existing.dossier_id !== precondition.dossier_id) {
        return fail("CASE_E_RECOVERY_REQUIRED", "The existing writer guard is invalid or indeterminate");
      }
      return ports.clock.isPossiblyStale(existing.created_at)
        ? fail("CASE_E_RECOVERY_REQUIRED", "The writer guard may be stale and requires explicit recovery")
        : fail("CASE_E_BUSY", "A writer guard is currently held");
    } catch {
      return fail("CASE_E_RECOVERY_REQUIRED", "The existing writer guard could not be inspected safely");
    }
  }

  const held = (basis: DossierSnapshot | null, mode: "ready" | "retry"): WriterGuard => ({
    store,
    ports,
    precondition,
    writerPath,
    recoveryPath,
    lockPath: writerPath,
    lockBytes: bytes,
    guardId,
    basis,
    mode,
    acquisitionFailure: null,
    recovery: false,
  });

  try {
    await ports.fs.flushFile(writerPath);
    const persisted = await ports.fs.readFile(writerPath);
    if (!Buffer.from(persisted).equals(Buffer.from(bytes)) || parseGuardRecord(persisted) === null) {
      return { ...held(null, "ready"), mode: "failed", basis: null,
        acquisitionFailure: mutationFailure("CASE_E_RECOVERY_REQUIRED", "The writer guard did not persist exactly") };
    }
    if (await readOptional(ports.fs, recoveryPath) !== null) {
      const provisional = held(null, "ready");
      const released = await releaseGuard(provisional);
      return fail(released
        ? "CASE_E_BUSY"
        : "CASE_E_RECOVERY_REQUIRED", released
        ? "Dossier recovery started while the writer guard was acquired"
        : "Writer/recovery guard overlap requires recovery");
    }
    const basis = await store.loadDossier(precondition.dossier_id);
    if (!snapshotMetadataIsValid(basis)) {
      const provisional = held(basis, "ready");
      const released = await releaseGuard(provisional);
      return fail(released ? "CASE_E_INVARIANT" : "CASE_E_RECOVERY_REQUIRED",
        released ? "The stored dossier mutation metadata or state digest is invalid" : "The writer guard could not be released safely");
    }
    const last = basis.last_operation;
    if (last !== null
      && last.operation_id === precondition.operation_id
      && last.basis_revision === precondition.expected_revision) {
      if (last.input_digest !== precondition.input_digest) {
        const provisional = held(basis, "ready");
        const released = await releaseGuard(provisional);
        return fail(released ? "CASE_E_CONFLICT" : "CASE_E_RECOVERY_REQUIRED",
          released ? "The operation ID was already used with different input" : "The writer guard could not be released safely");
      }
      return held(basis, "retry");
    }
    if (basis.state_revision !== precondition.expected_revision
      || basis.state_digest !== precondition.expected_state_digest) {
      const provisional = held(basis, "ready");
      const released = await releaseGuard(provisional);
      return fail(released ? "CASE_E_CONFLICT" : "CASE_E_RECOVERY_REQUIRED",
        released ? "The dossier basis no longer matches the mutation precondition" : "The writer guard could not be released safely");
    }
    return held(basis, "ready");
  } catch {
    const provisional = held(null, "ready");
    const released = await releaseGuard(provisional);
    return fail(released ? "CASE_E_INTERNAL" : "CASE_E_RECOVERY_REQUIRED",
      released ? "The dossier could not be reloaded safely under the writer guard" : "The writer guard could not be released safely");
  }
}

/** Acquire the exclusive dossier writer guard before reloading or comparing its basis. */
export async function acquireWriterGuard(
  store: CaseStore,
  precondition: GovernedMutationPrecondition,
  ports: MutationPorts,
): Promise<WriterGuard> {
  try {
    return await createGuard(store, precondition, ports);
  } catch {
    const writerPath = join(".case-agent", "locks", `${precondition.dossier_id}.lock`);
    const recoveryPath = join(".case-agent", "locks", `${precondition.dossier_id}.recovery.lock`);
    return failedGuard(store, ports, precondition, writerPath, recoveryPath,
      mutationFailure("CASE_E_INTERNAL", "The writer guard failed unexpectedly"));
  }
}

export async function guardIsOwned(guard: WriterGuard): Promise<boolean> {
  if (guard.lockPath === null || guard.lockBytes === null) return false;
  try {
    const current = await guard.ports.fs.readFile(guard.lockPath);
    return Buffer.from(current).equals(Buffer.from(guard.lockBytes)) && parseGuardRecord(current) !== null;
  } catch {
    return false;
  }
}

export async function releaseGuard(guard: WriterGuard): Promise<boolean> {
  if (!await guardIsOwned(guard) || guard.lockPath === null) return false;
  try {
    await guard.ports.fs.remove(guard.lockPath);
    return true;
  } catch {
    return false;
  }
}

async function releaseRecovery(
  fs: AtomicFsPort,
  path: string,
  bytes: Uint8Array,
): Promise<boolean> {
  try {
    const current = await fs.readFile(path);
    if (!Buffer.from(current).equals(Buffer.from(bytes)) || parseGuardRecord(current)?.kind !== "recovery") return false;
    await fs.remove(path);
    return true;
  } catch {
    return false;
  }
}

/** Recover only after interactive confirmation and conclusive recorded-owner termination. */
export async function recoverWriterGuard(
  store: CaseStore,
  request: RecoverWriterGuardRequest,
  ports: MutationPorts,
): Promise<ResultEnvelope<RecoverWriterGuardResult>> {
  if (!validSegment(request.dossier_id) || !validSegment(request.operation_id)
    || !isRevision(request.expected_revision) || !isDigest(request.expected_state_digest)) {
    return failure("guard recover", "CASE_E_USAGE", "Recovery requires a valid operation and exact mutation basis");
  }
  if (!ports.fs.profile.supported) {
    return failure("guard recover", "CASE_E_UNSUPPORTED_PROFILE", "Recovery is unavailable for this filesystem profile");
  }
  const writerPath = join(".case-agent", "locks", `${request.dossier_id}.lock`);
  const recoveryPath = join(".case-agent", "locks", `${request.dossier_id}.recovery.lock`);
  let recoveryId: string;
  let createdAt: string;
  let identity: ProcessIdentity;
  try {
    recoveryId = ports.ids.createGuardId();
    createdAt = ports.clock.now();
    identity = await ports.processIdentity.current();
    if (!validSegment(recoveryId) || !validTimestamp(createdAt)
      || identity.profile.length === 0 || identity.pid.length === 0 || !validTimestamp(identity.process_started_at)) {
      return failure("guard recover", "CASE_E_INTERNAL", "The recovery identity could not be recorded safely");
    }
  } catch {
    return failure("guard recover", "CASE_E_INTERNAL", "The recovery identity could not be recorded safely");
  }
  const recoveryInput = digestProjection({
    dossier_id: request.dossier_id,
    guard_id: recoveryId,
    kind: "writer-guard-recovery",
    operation_id: request.operation_id,
    expected_revision: request.expected_revision,
    expected_state_digest: request.expected_state_digest,
  });
  const recoveryRecord: GuardRecord = {
    kind: "recovery",
    guard_id: recoveryId,
    dossier_id: request.dossier_id,
    // Recovery acquires first; these non-authoritative placeholders are replaced
    // by a fresh snapshot basis only after the exclusive recovery guard persists.
    basis_revision: request.expected_revision,
    basis_state_digest: request.expected_state_digest,
    operation_id: request.operation_id,
    input_digest: recoveryInput,
    process_identity: identity,
    created_at: createdAt,
  };
  const recoveryBytes = guardBytes(recoveryRecord);
  try {
    await ports.fs.createOnce(recoveryPath, recoveryBytes);
    await ports.fs.flushFile(recoveryPath);
    const persisted = await ports.fs.readFile(recoveryPath);
    if (!Buffer.from(persisted).equals(Buffer.from(recoveryBytes)) || parseGuardRecord(persisted)?.kind !== "recovery") {
      return failure("guard recover", "CASE_E_RECOVERY_REQUIRED", "The recovery guard did not persist exactly");
    }
  } catch (error) {
    return failure("guard recover", isExists(error) ? "CASE_E_BUSY" : "CASE_E_INTERNAL",
      isExists(error) ? "Another recovery is already in progress" : "The recovery guard could not be acquired");
  }

  let basis: DossierSnapshot;
  try {
    basis = await store.loadDossier(request.dossier_id);
  } catch {
    const released = await releaseRecovery(ports.fs, recoveryPath, recoveryBytes);
    return failure("guard recover", released ? "CASE_E_INTERNAL" : "CASE_E_RECOVERY_REQUIRED",
      released ? "The recovery basis could not be loaded safely" : "The recovery guard could not be released safely");
  }
  if (basis.state_revision !== request.expected_revision || basis.state_digest !== request.expected_state_digest) {
    const released = await releaseRecovery(ports.fs, recoveryPath, recoveryBytes);
    return failure("guard recover", released ? "CASE_E_CONFLICT" : "CASE_E_RECOVERY_REQUIRED",
      released ? "The recovery basis is stale" : "The stale recovery basis could not release its guard safely");
  }

  let oldBytes: Uint8Array;
  let oldRecord: GuardRecord | null;
  try {
    oldBytes = await ports.fs.readFile(writerPath);
    oldRecord = parseGuardRecord(oldBytes);
  } catch {
    oldRecord = null;
    oldBytes = new Uint8Array();
  }
  if (oldRecord === null || oldRecord.kind !== "writer" || oldRecord.dossier_id !== request.dossier_id) {
    const released = await releaseRecovery(ports.fs, recoveryPath, recoveryBytes);
    return failure("guard recover", released ? "CASE_E_RECOVERY_REQUIRED" : "CASE_E_RECOVERY_REQUIRED",
      "The recorded writer guard cannot be proven safe for recovery");
  }

  let confirmed = false;
  try {
    confirmed = request.confirmation.interactive && await request.confirmation.confirmRecovery({
      dossier_id: request.dossier_id,
      guard_id: oldRecord.guard_id,
      created_at: oldRecord.created_at,
      process_identity: oldRecord.process_identity,
    });
  } catch {
    confirmed = false;
  }
  if (!confirmed) {
    const released = await releaseRecovery(ports.fs, recoveryPath, recoveryBytes);
    return failure("guard recover", released ? "CASE_E_HUMAN_CONFIRMATION" : "CASE_E_RECOVERY_REQUIRED",
      released ? "Interactive recovery confirmation was not recorded" : "The recovery guard could not be released safely");
  }

  let terminated: "terminated" | "live" | "unknown";
  try {
    terminated = await ports.processIdentity.verifyTerminated(oldRecord.process_identity);
  } catch {
    terminated = "unknown";
  }
  if (terminated !== "terminated") {
    await releaseRecovery(ports.fs, recoveryPath, recoveryBytes);
    return failure("guard recover", "CASE_E_RECOVERY_REQUIRED",
      "The recorded writer process has not been conclusively proven terminated");
  }

  const quarantinePath = `${writerPath}.quarantine-${recoveryId}`;
  try {
    const currentOld = await ports.fs.readFile(writerPath);
    if (!Buffer.from(currentOld).equals(Buffer.from(oldBytes))) throw new Error("writer lock identity changed");
    await ports.fs.quarantineOnce(writerPath, quarantinePath);
    basis = await store.loadDossier(request.dossier_id);
  } catch {
    return failure("guard recover", "CASE_E_RECOVERY_REQUIRED", "The stale writer guard could not be quarantined safely");
  }
  if (!snapshotMetadataIsValid(basis)) {
    return failure("guard recover", "CASE_E_RECOVERY_REQUIRED",
      "The post-quarantine dossier state is invalid; recovery remains exclusively guarded");
  }

  const recoveryPrecondition: GovernedMutationPrecondition = {
    dossier_id: request.dossier_id,
    expected_revision: basis.state_revision,
    expected_state_digest: basis.state_digest,
    operation_id: request.operation_id,
    input_digest: recoveryInput,
  };
  const recoveryGuard: WriterGuard = {
    store,
    ports,
    precondition: recoveryPrecondition,
    writerPath,
    recoveryPath,
    lockPath: recoveryPath,
    lockBytes: recoveryBytes,
    guardId: recoveryId,
    basis,
    mode: "ready",
    acquisitionFailure: null,
    recovery: true,
  };

  const { commitSnapshotMutation } = await import("./atomic.js");
  const committed = await commitSnapshotMutation(recoveryGuard, (current) => {
    const resultingRevision = revision((BigInt(current.state_revision) + 1n).toString());
    const candidate: DossierSnapshot = {
      ...current,
      state_revision: resultingRevision,
      state_digest: digestProjection({}),
      last_operation: {
        operation_id: recoveryPrecondition.operation_id,
        input_digest: recoveryInput,
        basis_revision: recoveryPrecondition.expected_revision,
        resulting_revision: resultingRevision,
      },
    };
    const snapshot = { ...candidate, state_digest: digestProjection(projectState(candidate)) };
    return { snapshot, data: { snapshot, quarantined_lock: quarantinePath } };
  });
  return committed;
}
