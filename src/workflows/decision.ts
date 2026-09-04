import { join } from "node:path";
import {
  DECISION_CONFIRMATION_PHRASE,
  RECORDED_IDENTITY_LIMITATION,
  type ConfirmationPort,
  type ExactSubmissionReview,
} from "../cli/confirm.js";
import { digestProjection } from "../protocol/canonical.js";
import { parseGovernedJson, type JsonValue } from "../protocol/json.js";
import { projectChecks, projectContent, projectState, projectSubmission } from "../protocol/projections.js";
import { failure, success, type FailureResultEnvelope, type ResultEnvelope } from "../protocol/result.js";
import {
  isDigest,
  isRevision,
  revision,
  type DecisionEnvelope,
  type Digest,
  type DossierSnapshot,
  type MutationPrecondition,
  type SubmissionEnvelope,
} from "../protocol/types.js";
import { commitEnvelopeMutation } from "../storage/atomic.js";
import { acquireWriterGuard, releaseGuard, type WriterGuard } from "../storage/guard.js";
import { isSafeOpaqueId, type WorkflowPorts } from "./dossier.js";
import { checkSnapshot } from "./evidence.js";

export interface DecisionRequest {
  readonly submission_id: string;
  readonly submission_digest: Digest;
  readonly decision: "accepted" | "rejected";
  readonly reviewer_id: string;
  readonly criteria_reviewed: string[];
  readonly comment: string;
}

export interface DecisionPorts extends WorkflowPorts {
  readonly confirmation: ConfirmationPort;
}

export type DecisionResult = DecisionEnvelope;

type CompleteDecisionRequest = DecisionRequest & MutationPrecondition;

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

function validRequest(value: unknown): value is CompleteDecisionRequest {
  return isRecord(value)
    && hasExactKeys(value, [
      "comment",
      "criteria_reviewed",
      "decision",
      "dossier_id",
      "expected_revision",
      "expected_state_digest",
      "operation_id",
      "reviewer_id",
      "submission_digest",
      "submission_id",
    ])
    && isSafeOpaqueId(value.dossier_id)
    && isSafeOpaqueId(value.submission_id)
    && nonEmptyText(value.operation_id)
    && nonEmptyText(value.reviewer_id)
    && typeof value.comment === "string"
    && !value.comment.includes("\0")
    && (value.decision === "accepted" || value.decision === "rejected")
    && Array.isArray(value.criteria_reviewed)
    && value.criteria_reviewed.every(isSafeOpaqueId)
    && isRevision(value.expected_revision)
    && isDigest(value.expected_state_digest)
    && isDigest(value.submission_digest);
}

function decisionInput(request: DecisionRequest): JsonValue {
  return {
    submission_id: request.submission_id,
    submission_digest: request.submission_digest,
    decision: request.decision,
    reviewer_id: request.reviewer_id,
    criteria_reviewed: [...request.criteria_reviewed],
    comment: request.comment,
  };
}

function commandFor(request: Pick<DecisionRequest, "decision">): "decision.accept" | "decision.reject" {
  return request.decision === "accepted" ? "decision.accept" : "decision.reject";
}

function publicResult(
  request: DecisionRequest,
  result: ResultEnvelope<DecisionResult>,
): ResultEnvelope<DecisionResult> {
  const command = commandFor(request);
  return result.ok
    ? success(command, request.decision === "accepted" ? "Recorded Human Acceptance" : "Recorded Human Rejection", result.data)
    : { ...result, command };
}

async function failHeld(
  request: DecisionRequest,
  guard: WriterGuard,
  code: FailureResultEnvelope["code"],
  message: string,
): Promise<FailureResultEnvelope> {
  return await releaseGuard(guard)
    ? failure(commandFor(request), code, message)
    : failure(commandFor(request), "CASE_E_RECOVERY_REQUIRED", "The decision failed and its guard could not be released safely");
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function criteriaAreExact(actual: readonly string[], snapshot: DossierSnapshot): boolean {
  const expected = snapshot.acceptance_criteria.map(({ criterion_id }) => criterion_id);
  return actual.length === expected.length
    && actual.every((criterionId, index) => criterionId === expected[index]);
}

function currentSubmissionIsExact(
  submission: SubmissionEnvelope,
  snapshot: DossierSnapshot,
  checked: Awaited<ReturnType<typeof checkSnapshot>>,
): boolean {
  return submission.submission_id === snapshot.current_submission_id
    && submission.dossier_id === snapshot.dossier_id
    && submission.submission_digest === digestProjection(projectSubmission(submission))
    && submission.content_digest === digestProjection(projectContent(snapshot))
    && submission.observed_evidence_digest === checked.checks.observed_evidence_digest
    && submission.checks_digest === digestProjection(projectChecks(checked.checks));
}

function persistedDecisionIsExact(
  envelope: DecisionEnvelope,
  current: DossierSnapshot,
  submission: SubmissionEnvelope,
  request: CompleteDecisionRequest,
  decisionId: string,
): boolean {
  return envelope.decision_id === decisionId
    && envelope.dossier_id === current.dossier_id
    && envelope.submission_id === submission.submission_id
    && envelope.submission_id === request.submission_id
    && envelope.submission_digest === submission.submission_digest
    && envelope.submission_digest === request.submission_digest
    && envelope.decision === request.decision
    && envelope.reviewer_id === request.reviewer_id
    && envelope.criteria_reviewed.length === request.criteria_reviewed.length
    && envelope.criteria_reviewed.every((criterionId, index) => criterionId === request.criteria_reviewed[index])
    && criteriaAreExact(envelope.criteria_reviewed, current)
    && envelope.comment === request.comment
    && envelope.created_operation_id === request.operation_id
    && envelope.identity_assurance === "recorded-interactive-claim";
}

function nextSnapshot(
  basis: DossierSnapshot,
  request: CompleteDecisionRequest,
  inputDigest: Digest,
  decisionId: string,
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
    current_decision_id: decisionId,
  };
  return { ...candidate, state_digest: digestProjection(projectState(candidate)) };
}

async function existingDecision(
  request: CompleteDecisionRequest,
  decisionId: string,
  ports: DecisionPorts,
): Promise<DecisionEnvelope | null> {
  const path = join(
    ".case-agent",
    "dossiers",
    request.dossier_id,
    "decisions",
    `${decisionId}.json`,
  );
  let bytes: Uint8Array;
  try {
    bytes = await ports.fs.readFile(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  const parsed = parseGovernedJson(bytes);
  if (!ports.schemas.validate("decision", parsed).ok) {
    throw new Error("CASE_E_CONFLICT: existing decision is invalid");
  }
  return parsed as unknown as DecisionEnvelope;
}

/** Record an interactive decision only for the exact current immutable submission. */
export async function recordDecision(
  request: DecisionRequest & MutationPrecondition,
  ports: DecisionPorts,
): Promise<ResultEnvelope<DecisionResult>> {
  if (!validRequest(request)) {
    return failure(commandFor(request), "CASE_E_USAGE", "A valid exact-submission decision and mutation precondition are required");
  }
  let decisionId: string;
  try {
    decisionId = ports.ids.envelopeIdFor("decision", request.operation_id);
    if (!isSafeOpaqueId(decisionId)) throw new Error("unsafe decision id");
  } catch {
    return failure(commandFor(request), "CASE_E_INTERNAL", "A safe decision identifier could not be derived");
  }
  const inputProjection = decisionInput(request);
  const inputDigest = digestProjection(inputProjection);
  const guard = await acquireWriterGuard(ports.store, {
    dossier_id: request.dossier_id,
    expected_revision: request.expected_revision,
    expected_state_digest: request.expected_state_digest,
    operation_id: request.operation_id,
    input_digest: inputDigest,
  }, ports);
  if (guard.mode === "failed") {
    return publicResult(request, guard.acquisitionFailure
      ?? failure("mutation", "CASE_E_INTERNAL", "Writer acquisition failed"));
  }
  if (guard.basis === null) return failHeld(request, guard, "CASE_E_INTERNAL", "The decision has no validated basis");
  if (guard.basis.current_submission_id !== request.submission_id) {
    return failHeld(request, guard, "CASE_E_CONFLICT", "The addressed submission is no longer current");
  }
  let checked: Awaited<ReturnType<typeof checkSnapshot>>;
  try {
    checked = await checkSnapshot(guard.basis, ports);
  } catch {
    return failHeld(request, guard, "CASE_E_INTERNAL", "The current submission could not be inspected safely");
  }
  const submission = checked.envelopes.submission;
  if (!checked.envelopes.integrity || submission === null) {
    return failHeld(request, guard, "CASE_E_INVARIANT", "The current submission envelope is unavailable or inconsistent");
  }
  if (submission.submission_digest !== request.submission_digest
    || !currentSubmissionIsExact(submission, guard.basis, checked)) {
    return failHeld(request, guard, "CASE_E_CONFLICT", "The supplied submission digest is not the exact current submission");
  }
  if (!criteriaAreExact(request.criteria_reviewed, guard.basis)) {
    return failHeld(request, guard, "CASE_E_TRANSITION", "Every current criterion must be reviewed in canonical order");
  }
  if (!ports.confirmation.interactive) {
    return failHeld(request, guard, "CASE_E_HUMAN_CONFIRMATION", "An interactive TTY is required to record a human decision");
  }

  let envelope: DecisionEnvelope;
  try {
    const persisted = await existingDecision(request, decisionId, ports);
    envelope = persisted ?? {
      decision_id: decisionId,
      dossier_id: guard.basis.dossier_id,
      submission_id: submission.submission_id,
      submission_digest: submission.submission_digest,
      decision: request.decision,
      reviewer_id: request.reviewer_id,
      criteria_reviewed: [...request.criteria_reviewed],
      comment: request.comment,
      decided_at: ports.clock.now(),
      created_operation_id: request.operation_id,
      identity_assurance: "recorded-interactive-claim",
    };
    if (!ports.schemas.validate("decision", envelope).ok
      || !persistedDecisionIsExact(envelope, guard.basis, submission, request, decisionId)) {
      return failHeld(request, guard, persisted === null ? "CASE_E_INTERNAL" : "CASE_E_CONFLICT",
        persisted === null
          ? "The generated decision envelope is invalid"
          : "The operation's immutable decision envelope conflicts with this review");
    }
  } catch (error) {
    const conflict = error instanceof Error && error.message.startsWith("CASE_E_CONFLICT:");
    return failHeld(request, guard, conflict ? "CASE_E_CONFLICT" : "CASE_E_INTERNAL",
      conflict ? "The operation's immutable decision envelope is invalid" : "The decision envelope could not be prepared safely");
  }

  const review: ExactSubmissionReview = {
    submission,
    acceptance_criteria: guard.basis.acceptance_criteria.map((criterion) => ({ ...criterion })),
    decision_envelope: envelope,
    identity_limitation: RECORDED_IDENTITY_LIMITATION,
  };
  let confirmed: boolean;
  try {
    confirmed = await ports.confirmation.confirmDecision(review, DECISION_CONFIRMATION_PHRASE);
  } catch {
    return failHeld(request, guard, "CASE_E_INTERNAL", "The interactive confirmation adapter failed unexpectedly");
  }
  if (!confirmed) {
    return failHeld(request, guard, "CASE_E_HUMAN_CONFIRMATION", "The fixed decision confirmation phrase was not recorded");
  }

  const result = await commitEnvelopeMutation(guard, {
    kind: "decision",
    envelope_id: decisionId,
    input_projection: inputProjection,
    create: () => ({
      decision_id: envelope.decision_id,
      dossier_id: envelope.dossier_id,
      submission_id: envelope.submission_id,
      submission_digest: envelope.submission_digest,
      decision: envelope.decision,
      reviewer_id: envelope.reviewer_id,
      criteria_reviewed: [...envelope.criteria_reviewed],
      comment: envelope.comment,
      decided_at: envelope.decided_at,
      created_operation_id: envelope.created_operation_id,
      identity_assurance: envelope.identity_assurance,
    }),
    projectInput: (persisted) => decisionInput(persisted),
    validatePersisted: (persisted, current) => persistedDecisionIsExact(
      persisted,
      current,
      submission,
      request,
      decisionId,
    ),
    buildSnapshot: (basis, persisted) => ({
      snapshot: nextSnapshot(basis, request, inputDigest, persisted.decision_id),
      data: persisted,
    }),
    recover: (_committed, persisted) => persisted,
  });
  return publicResult(request, result);
}
