import { digestProjection } from "../protocol/canonical.js";
import type { JsonValue } from "../protocol/json.js";
import { projectChecks, projectContent, projectState, projectSubmission } from "../protocol/projections.js";
import { failure, success, type FailureResultEnvelope, type ResultEnvelope } from "../protocol/result.js";
import {
  isDigest,
  isRevision,
  revision,
  type Digest,
  type DossierSnapshot,
  type MutationPrecondition,
  type SubmissionEnvelope,
} from "../protocol/types.js";
import { commitEnvelopeMutation } from "../storage/atomic.js";
import { acquireWriterGuard, releaseGuard, type WriterGuard } from "../storage/guard.js";
import { isSafeOpaqueId, type WorkflowPorts } from "./dossier.js";
import { checkSnapshot } from "./evidence.js";

export interface CreateSubmissionRequest {
  readonly submitting_run_id: string;
}

export type CreateSubmissionResult = SubmissionEnvelope;

type CompleteSubmissionRequest = CreateSubmissionRequest & MutationPrecondition;

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

function validRequest(value: unknown): value is CompleteSubmissionRequest {
  return isRecord(value)
    && hasExactKeys(value, [
      "dossier_id",
      "expected_revision",
      "expected_state_digest",
      "operation_id",
      "submitting_run_id",
    ])
    && isSafeOpaqueId(value.dossier_id)
    && isSafeOpaqueId(value.submitting_run_id)
    && nonEmptyText(value.operation_id)
    && isRevision(value.expected_revision)
    && isDigest(value.expected_state_digest);
}

function submissionInput(request: CreateSubmissionRequest): JsonValue {
  return { submitting_run_id: request.submitting_run_id };
}

function publicFailure(result: FailureResultEnvelope): FailureResultEnvelope {
  return { ...result, command: "submission.create" };
}

function publicResult(result: ResultEnvelope<CreateSubmissionResult>): ResultEnvelope<CreateSubmissionResult> {
  return result.ok
    ? success("submission.create", "Exact submission created", result.data)
    : publicFailure(result);
}

async function failHeld(
  guard: WriterGuard,
  code: FailureResultEnvelope["code"],
  message: string,
): Promise<FailureResultEnvelope> {
  return await releaseGuard(guard)
    ? failure("submission.create", code, message)
    : failure("submission.create", "CASE_E_RECOVERY_REQUIRED", "The submission failed and its guard could not be released safely");
}

function nextSnapshot(
  basis: DossierSnapshot,
  request: CompleteSubmissionRequest,
  inputDigest: Digest,
  submissionId: string,
): DossierSnapshot {
  const resultingRevision = revision((BigInt(basis.state_revision) + 1n).toString());
  const candidate: DossierSnapshot = {
    ...basis,
    state_revision: resultingRevision,
    state_digest: digestProjection({}),
    last_operation: {
      operation_id: request.operation_id,
      input_digest: inputDigest,
      basis_revision: request.expected_revision,
      resulting_revision: resultingRevision,
    },
    current_submission_id: submissionId,
    current_decision_id: null,
  };
  return { ...candidate, state_digest: digestProjection(projectState(candidate)) };
}

function persistedSubmissionIsExact(
  envelope: SubmissionEnvelope,
  current: DossierSnapshot,
  request: CompleteSubmissionRequest,
  submissionId: string,
  contentDigest: Digest,
  observedEvidenceDigest: Digest,
  checksDigest: Digest,
): boolean {
  let publishedRevision: string;
  try {
    publishedRevision = (BigInt(request.expected_revision) + 1n).toString();
  } catch {
    return false;
  }
  return envelope.submission_id === submissionId
    && envelope.dossier_id === request.dossier_id
    && envelope.submitting_run_id === request.submitting_run_id
    && envelope.submitting_run_id === current.active_run.run_id
    && envelope.basis_revision === request.expected_revision
    && envelope.basis_state_digest === request.expected_state_digest
    && envelope.published_revision === publishedRevision
    && envelope.content_digest === contentDigest
    && envelope.observed_evidence_digest === observedEvidenceDigest
    && envelope.checks_digest === checksDigest
    && envelope.created_operation_id === request.operation_id
    && envelope.submission_digest === digestProjection(projectSubmission(envelope));
}

/** Rerun current checks under the writer guard before publishing an exact submission. */
export async function createSubmission(
  request: CreateSubmissionRequest & MutationPrecondition,
  ports: WorkflowPorts,
): Promise<ResultEnvelope<CreateSubmissionResult>> {
  if (!validRequest(request)) {
    return failure("submission.create", "CASE_E_USAGE", "A valid submission and mutation precondition are required");
  }
  let submissionId: string;
  try {
    submissionId = ports.ids.envelopeIdFor("submission", request.operation_id);
    if (!isSafeOpaqueId(submissionId)) throw new Error("unsafe submission id");
  } catch {
    return failure("submission.create", "CASE_E_INTERNAL", "A safe submission identifier could not be derived");
  }
  const inputProjection = submissionInput(request);
  const inputDigest = digestProjection(inputProjection);
  const guard = await acquireWriterGuard(ports.store, {
    dossier_id: request.dossier_id,
    expected_revision: request.expected_revision,
    expected_state_digest: request.expected_state_digest,
    operation_id: request.operation_id,
    input_digest: inputDigest,
  }, ports);
  if (guard.mode === "failed") {
    return publicFailure(guard.acquisitionFailure
      ?? failure("mutation", "CASE_E_INTERNAL", "Writer acquisition failed"));
  }
  if (guard.basis === null) {
    return failHeld(guard, "CASE_E_INTERNAL", "The submission has no validated basis");
  }
  if (guard.basis.active_run.run_id !== request.submitting_run_id) {
    return failHeld(guard, "CASE_E_ACTOR", "Only the active run can submit work");
  }
  let checked;
  try {
    checked = await checkSnapshot(guard.basis, ports);
    if (!checked.envelopes.integrity) {
      return failHeld(guard, "CASE_E_INVARIANT", "A current immutable envelope is unavailable or inconsistent");
    }
    if (checked.checks.verdict !== "passed") {
      return failHeld(guard, "CASE_E_EVIDENCE", "Current checks do not permit submission");
    }
  } catch {
    return failHeld(guard, "CASE_E_INTERNAL", "Current checks could not be rerun safely");
  }
  const currentHandoff = checked.envelopes.handoff;
  const handoffAccepted = currentHandoff !== null
    && guard.basis.active_run.started_by_handoff_id === currentHandoff.handoff_id
    && guard.basis.active_run.actor_id === currentHandoff.to_actor_id;
  if (guard.basis.current_handoff_id !== null && !handoffAccepted) {
    return failHeld(guard, "CASE_E_TRANSITION", "A current handoff must be accepted before submission");
  }

  const contentDigest = digestProjection(projectContent(guard.basis));
  const observedEvidenceDigest = checked.checks.observed_evidence_digest;
  const checksDigest = digestProjection(projectChecks(checked.checks));
  const result = await commitEnvelopeMutation(guard, {
    kind: "submission",
    envelope_id: submissionId,
    input_projection: inputProjection,
    create: () => {
      const withoutDigest = {
        submission_id: submissionId,
        dossier_id: request.dossier_id,
        submitting_run_id: request.submitting_run_id,
        basis_revision: request.expected_revision,
        basis_state_digest: request.expected_state_digest,
        published_revision: revision((BigInt(request.expected_revision) + 1n).toString()),
        content_digest: contentDigest,
        observed_evidence_digest: observedEvidenceDigest,
        checks_digest: checksDigest,
        created_at: ports.clock.now(),
        created_operation_id: request.operation_id,
      };
      return {
        ...withoutDigest,
        submission_digest: digestProjection(withoutDigest),
      };
    },
    projectInput: (envelope) => submissionInput(envelope),
    validatePersisted: (envelope, current) => persistedSubmissionIsExact(
      envelope,
      current,
      request,
      submissionId,
      contentDigest,
      observedEvidenceDigest,
      checksDigest,
    ),
    buildSnapshot: (basis, envelope) => ({
      snapshot: nextSnapshot(basis, request, inputDigest, envelope.submission_id),
      data: envelope,
    }),
    recover: (_committed, envelope) => envelope,
  });
  return publicResult(result);
}
