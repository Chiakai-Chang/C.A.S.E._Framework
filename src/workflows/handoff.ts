import { join } from "node:path";
import { digestProjection } from "../protocol/canonical.js";
import { parseGovernedJson, type JsonValue } from "../protocol/json.js";
import { projectContent, projectState } from "../protocol/projections.js";
import { failure, success, type FailureResultEnvelope, type ResultEnvelope } from "../protocol/result.js";
import {
  isDigest,
  isRevision,
  revision,
  type Digest,
  type DossierSnapshot,
  type HandoffEnvelope,
  type MutationPrecondition,
} from "../protocol/types.js";
import { commitEnvelopeMutation, commitSnapshotMutation } from "../storage/atomic.js";
import { acquireWriterGuard, releaseGuard, type WriterGuard } from "../storage/guard.js";
import { isSafeOpaqueId, type WorkflowPorts } from "./dossier.js";

export interface OfferHandoffRequest {
  readonly from_run_id: string;
  readonly to_actor_id: string;
}

export interface AcceptHandoffRequest {
  readonly handoff_id: string;
  readonly offered_content_digest: Digest;
  readonly actor_id: string;
}

export type OfferHandoffResult = HandoffEnvelope;
export type AcceptHandoffResult = DossierSnapshot;

type CompleteOfferRequest = OfferHandoffRequest & MutationPrecondition;
type CompleteAcceptRequest = AcceptHandoffRequest & MutationPrecondition;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function validMutationPrecondition(value: Record<string, unknown>): boolean {
  return isSafeOpaqueId(value.dossier_id)
    && nonEmptyText(value.operation_id)
    && isRevision(value.expected_revision)
    && isDigest(value.expected_state_digest);
}

function validOfferRequest(value: unknown): value is CompleteOfferRequest {
  return isRecord(value)
    && hasExactKeys(value, [
      "dossier_id",
      "expected_revision",
      "expected_state_digest",
      "from_run_id",
      "operation_id",
      "to_actor_id",
    ])
    && validMutationPrecondition(value)
    && isSafeOpaqueId(value.from_run_id)
    && nonEmptyText(value.to_actor_id);
}

function validAcceptRequest(value: unknown): value is CompleteAcceptRequest {
  return isRecord(value)
    && hasExactKeys(value, [
      "actor_id",
      "dossier_id",
      "expected_revision",
      "expected_state_digest",
      "handoff_id",
      "offered_content_digest",
      "operation_id",
    ])
    && validMutationPrecondition(value)
    && isSafeOpaqueId(value.handoff_id)
    && isDigest(value.offered_content_digest)
    && nonEmptyText(value.actor_id);
}

function offerInput(request: OfferHandoffRequest): JsonValue {
  return { from_run_id: request.from_run_id, to_actor_id: request.to_actor_id };
}

function acceptanceInput(request: AcceptHandoffRequest): JsonValue {
  return {
    handoff_id: request.handoff_id,
    offered_content_digest: request.offered_content_digest,
    actor_id: request.actor_id,
  };
}

function publicResult<T>(
  command: "handoff.offer" | "handoff.accept",
  message: string,
  result: ResultEnvelope<T>,
): ResultEnvelope<T> {
  return result.ok
    ? success(command, message, result.data)
    : { ...result, command };
}

async function failHeld(
  command: "handoff.offer" | "handoff.accept",
  guard: WriterGuard,
  code: FailureResultEnvelope["code"],
  message: string,
): Promise<FailureResultEnvelope> {
  return await releaseGuard(guard)
    ? failure(command, code, message)
    : failure(command, "CASE_E_RECOVERY_REQUIRED", "The handoff mutation failed and its guard could not be released safely");
}

function nextSnapshot(
  basis: DossierSnapshot,
  request: MutationPrecondition,
  inputDigest: Digest,
  changes: Pick<DossierSnapshot, "active_run" | "current_handoff_id">,
): DossierSnapshot {
  const resultingRevision = revision((BigInt(basis.state_revision) + 1n).toString());
  const candidate: DossierSnapshot = {
    ...basis,
    ...changes,
    state_revision: resultingRevision,
    state_digest: digestProjection({}),
    last_operation: {
      operation_id: request.operation_id,
      input_digest: inputDigest,
      basis_revision: request.expected_revision,
      resulting_revision: resultingRevision,
    },
  };
  return { ...candidate, state_digest: digestProjection(projectState(candidate)) };
}

function persistedOfferIsExact(
  envelope: HandoffEnvelope,
  current: DossierSnapshot,
  request: CompleteOfferRequest,
  handoffId: string,
): boolean {
  let publishedRevision: string;
  try {
    publishedRevision = (BigInt(request.expected_revision) + 1n).toString();
  } catch {
    return false;
  }
  return envelope.handoff_id === handoffId
    && envelope.dossier_id === request.dossier_id
    && envelope.from_run_id === request.from_run_id
    && envelope.from_run_id === current.active_run.run_id
    && envelope.to_actor_id === request.to_actor_id
    && envelope.basis_revision === request.expected_revision
    && envelope.basis_state_digest === request.expected_state_digest
    && envelope.published_revision === publishedRevision
    && envelope.offered_content_digest === digestProjection(projectContent(current))
    && envelope.created_operation_id === request.operation_id;
}

/** Publish an immutable handoff offer without transferring active-run authority. */
export async function offerHandoff(
  request: OfferHandoffRequest & MutationPrecondition,
  ports: WorkflowPorts,
): Promise<ResultEnvelope<OfferHandoffResult>> {
  if (!validOfferRequest(request)) {
    return failure("handoff.offer", "CASE_E_USAGE", "A valid handoff offer and mutation precondition are required");
  }
  let handoffId: string;
  try {
    handoffId = ports.ids.envelopeIdFor("handoff", request.operation_id);
    if (!isSafeOpaqueId(handoffId)) throw new Error("unsafe handoff id");
  } catch {
    return failure("handoff.offer", "CASE_E_INTERNAL", "A safe handoff identifier could not be derived");
  }
  const inputDigest = digestProjection(offerInput(request));
  const guard = await acquireWriterGuard(ports.store, {
    dossier_id: request.dossier_id,
    expected_revision: request.expected_revision,
    expected_state_digest: request.expected_state_digest,
    operation_id: request.operation_id,
    input_digest: inputDigest,
  }, ports);
  if (guard.mode === "failed") {
    return publicResult<OfferHandoffResult>("handoff.offer", "Handoff offered", guard.acquisitionFailure
      ?? failure("mutation", "CASE_E_INTERNAL", "Writer acquisition failed"));
  }
  if (guard.basis === null) {
    return failHeld("handoff.offer", guard, "CASE_E_INTERNAL", "The handoff offer has no validated basis");
  }
  if (guard.basis.active_run.run_id !== request.from_run_id) {
    return failHeld("handoff.offer", guard, "CASE_E_ACTOR", "Only the active run can offer a handoff");
  }

  const result = await commitEnvelopeMutation(guard, {
    kind: "handoff",
    envelope_id: handoffId,
    input_projection: offerInput(request),
    create: (basis) => ({
      handoff_id: handoffId,
      dossier_id: basis.dossier_id,
      from_run_id: request.from_run_id,
      to_actor_id: request.to_actor_id,
      basis_revision: request.expected_revision,
      basis_state_digest: request.expected_state_digest,
      published_revision: revision((BigInt(request.expected_revision) + 1n).toString()),
      offered_content_digest: digestProjection(projectContent(basis)),
      created_operation_id: request.operation_id,
    }),
    projectInput: (envelope) => offerInput(envelope),
    validatePersisted: (envelope, current) => persistedOfferIsExact(envelope, current, request, handoffId),
    buildSnapshot: (basis, envelope) => {
      const snapshot = nextSnapshot(basis, request, inputDigest, {
        active_run: basis.active_run,
        current_handoff_id: envelope.handoff_id,
      });
      return { snapshot, data: envelope };
    },
    recover: (_committed, envelope) => envelope,
  });
  return publicResult("handoff.offer", "Handoff offered", result);
}

type OfferReadOutcome =
  | { readonly kind: "ok"; readonly offer: HandoffEnvelope }
  | { readonly kind: "invalid" }
  | { readonly kind: "internal" };

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function readOffer(
  request: CompleteAcceptRequest,
  basis: DossierSnapshot,
  ports: WorkflowPorts,
): Promise<OfferReadOutcome> {
  const path = join(
    ".case-agent",
    "dossiers",
    request.dossier_id,
    "handoffs",
    `${request.handoff_id}.json`,
  );
  let bytes: Uint8Array;
  try {
    bytes = await ports.fs.readFile(path);
  } catch (error) {
    return isMissing(error) ? { kind: "invalid" } : { kind: "internal" };
  }
  let parsed: JsonValue;
  try {
    parsed = parseGovernedJson(bytes);
  } catch {
    return { kind: "invalid" };
  }
  try {
    if (!ports.schemas.validate("handoff", parsed).ok) return { kind: "invalid" };
  } catch {
    return { kind: "internal" };
  }
  const envelope = parsed as unknown as HandoffEnvelope;
  if (envelope.handoff_id !== request.handoff_id
    || envelope.dossier_id !== basis.dossier_id
    || !isSafeOpaqueId(envelope.from_run_id)
    || !nonEmptyText(envelope.to_actor_id)
    || !isRevision(envelope.basis_revision)
    || !isDigest(envelope.basis_state_digest)
    || !isRevision(envelope.published_revision)
    || !isDigest(envelope.offered_content_digest)
    || !nonEmptyText(envelope.created_operation_id)) return { kind: "invalid" };
  let derivedId: string;
  try {
    derivedId = ports.ids.envelopeIdFor("handoff", envelope.created_operation_id);
  } catch {
    return { kind: "internal" };
  }
  if (derivedId !== envelope.handoff_id) return { kind: "invalid" };
  try {
    if (BigInt(envelope.basis_revision) + 1n !== BigInt(envelope.published_revision)) return { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
  return { kind: "ok", offer: envelope };
}

function publicationLinksAreExact(
  basis: DossierSnapshot,
  offer: HandoffEnvelope,
): boolean {
  const operation = basis.last_operation;
  return operation !== null
    && basis.state_revision === offer.published_revision
    && operation.operation_id === offer.created_operation_id
    && operation.input_digest === digestProjection(offerInput(offer))
    && operation.basis_revision === offer.basis_revision
    && operation.resulting_revision === offer.published_revision;
}

/** Accept the still-current offer and atomically create the recipient's active run. */
export async function acceptHandoff(
  request: AcceptHandoffRequest & MutationPrecondition,
  ports: WorkflowPorts,
): Promise<ResultEnvelope<AcceptHandoffResult>> {
  if (!validAcceptRequest(request)) {
    return failure("handoff.accept", "CASE_E_USAGE", "A valid handoff acceptance and mutation precondition are required");
  }
  const inputDigest = digestProjection(acceptanceInput(request));
  const guard = await acquireWriterGuard(ports.store, {
    dossier_id: request.dossier_id,
    expected_revision: request.expected_revision,
    expected_state_digest: request.expected_state_digest,
    operation_id: request.operation_id,
    input_digest: inputDigest,
  }, ports);
  if (guard.mode === "failed") {
    return publicResult<AcceptHandoffResult>("handoff.accept", "Handoff accepted", guard.acquisitionFailure
      ?? failure("mutation", "CASE_E_INTERNAL", "Writer acquisition failed"));
  }
  if (guard.basis === null) {
    return failHeld("handoff.accept", guard, "CASE_E_INTERNAL", "The handoff acceptance has no validated basis");
  }
  if (guard.basis.current_handoff_id !== request.handoff_id) {
    return failHeld("handoff.accept", guard, "CASE_E_CONFLICT", "The addressed handoff is no longer current");
  }
  const read = await readOffer(request, guard.basis, ports);
  if (read.kind === "internal") {
    return failHeld("handoff.accept", guard, "CASE_E_INTERNAL", "The current handoff offer could not be inspected safely");
  }
  if (read.kind === "invalid") {
    return failHeld("handoff.accept", guard, "CASE_E_INVARIANT", "The current handoff offer is unavailable or invalid");
  }
  const offer = read.offer;
  if (offer.to_actor_id !== request.actor_id) {
    return failHeld("handoff.accept", guard, "CASE_E_ACTOR", "Only the intended recipient actor can accept this handoff");
  }
  if (offer.offered_content_digest !== request.offered_content_digest) {
    return failHeld("handoff.accept", guard, "CASE_E_CONFLICT", "The supplied offered content digest does not match the offer");
  }

  if (guard.mode === "retry") {
    if (guard.basis.active_run.started_by_handoff_id !== offer.handoff_id
      || guard.basis.active_run.actor_id !== offer.to_actor_id
      || digestProjection(projectContent(guard.basis)) !== offer.offered_content_digest) {
      return failHeld("handoff.accept", guard, "CASE_E_TRANSITION", "The prior handoff acceptance cannot be reconstructed");
    }
    return publicResult("handoff.accept", "Handoff accepted",
      await commitSnapshotMutation(guard, () => failure("mutation", "CASE_E_INTERNAL", "Retry unexpectedly rebuilt acceptance")));
  }

  if (guard.basis.active_run.started_by_handoff_id === offer.handoff_id) {
    return failHeld("handoff.accept", guard, "CASE_E_TRANSITION", "The handoff offer has already been accepted");
  }
  if (guard.basis.active_run.run_id !== offer.from_run_id) {
    return failHeld("handoff.accept", guard, "CASE_E_ACTOR", "The offering run is no longer active");
  }
  if (guard.basis.state_revision !== offer.published_revision
    || request.expected_revision !== offer.published_revision
    || digestProjection(projectContent(guard.basis)) !== offer.offered_content_digest
    || !publicationLinksAreExact(guard.basis, offer)) {
    return failHeld("handoff.accept", guard, "CASE_E_CONFLICT", "The handoff offer is stale against the current dossier state");
  }

  let runId: string;
  try {
    runId = ports.ids.createRunId();
    if (!isSafeOpaqueId(runId) || runId === guard.basis.active_run.run_id) throw new Error("unsafe run id");
  } catch {
    return failHeld("handoff.accept", guard, "CASE_E_INTERNAL", "A safe new run identifier could not be generated");
  }
  const result = await commitSnapshotMutation(guard, (basis) => {
    const snapshot = nextSnapshot(basis, request, inputDigest, {
      active_run: {
        run_id: runId,
        actor_id: request.actor_id,
        started_by_handoff_id: offer.handoff_id,
      },
      current_handoff_id: offer.handoff_id,
    });
    return { snapshot, data: snapshot };
  });
  return publicResult("handoff.accept", "Handoff accepted", result);
}
