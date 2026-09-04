import type { JsonValue } from "./json.js";
import type {
  ChecksProjection,
  DossierSnapshot,
  EvidenceRecord,
  ObservedEvidenceProjection,
  SubmissionEnvelope,
} from "./types.js";

function compareAscii(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function sortedCodes(codes: readonly string[]): string[] {
  return Array.from(codes).sort(compareAscii);
}

function projectAcceptanceCriteria(snapshot: DossierSnapshot): JsonValue[] {
  return snapshot.acceptance_criteria.map((criterion) => ({
    criterion_id: criterion.criterion_id,
    statement: criterion.statement,
    verification: criterion.verification,
  } satisfies JsonValue));
}

function projectEvidence(record: EvidenceRecord, includeCapturedAt: boolean): JsonValue {
  if (record.kind === "file" || record.kind === "command_result") {
    return includeCapturedAt
      ? {
          evidence_id: record.evidence_id,
          criterion_ids: record.criterion_ids.map((criterionId) => criterionId),
          captured_at: record.captured_at,
          freshness: record.freshness,
          limitations: record.limitations.map((limitation) => limitation),
          kind: record.kind,
          location: { repository_relative_path: record.location.repository_relative_path },
          artifact_digest: record.artifact_digest,
          artifact_size: record.artifact_size,
        } satisfies JsonValue
      : {
          evidence_id: record.evidence_id,
          criterion_ids: record.criterion_ids.map((criterionId) => criterionId),
          freshness: record.freshness,
          limitations: record.limitations.map((limitation) => limitation),
          kind: record.kind,
          location: { repository_relative_path: record.location.repository_relative_path },
          artifact_digest: record.artifact_digest,
          artifact_size: record.artifact_size,
        } satisfies JsonValue;
  }

  if (record.kind === "external_reference") {
    return includeCapturedAt
      ? {
          evidence_id: record.evidence_id,
          criterion_ids: record.criterion_ids.map((criterionId) => criterionId),
          captured_at: record.captured_at,
          freshness: record.freshness,
          limitations: record.limitations.map((limitation) => limitation),
          kind: record.kind,
          location: { uri: record.location.uri },
        } satisfies JsonValue
      : {
          evidence_id: record.evidence_id,
          criterion_ids: record.criterion_ids.map((criterionId) => criterionId),
          freshness: record.freshness,
          limitations: record.limitations.map((limitation) => limitation),
          kind: record.kind,
          location: { uri: record.location.uri },
        } satisfies JsonValue;
  }

  if (record.kind === "human_observation") {
    return includeCapturedAt
      ? {
          evidence_id: record.evidence_id,
          criterion_ids: record.criterion_ids.map((criterionId) => criterionId),
          captured_at: record.captured_at,
          freshness: record.freshness,
          limitations: record.limitations.map((limitation) => limitation),
          kind: record.kind,
          location: { statement: record.location.statement },
        } satisfies JsonValue
      : {
          evidence_id: record.evidence_id,
          criterion_ids: record.criterion_ids.map((criterionId) => criterionId),
          freshness: record.freshness,
          limitations: record.limitations.map((limitation) => limitation),
          kind: record.kind,
          location: { statement: record.location.statement },
        } satisfies JsonValue;
  }

  throw new TypeError("CASE_E_CANONICAL: unsupported evidence kind");
}

/** Project every stored dossier field except its self-referential state digest. */
export function projectState(snapshot: DossierSnapshot): JsonValue {
  return {
    dossier_id: snapshot.dossier_id,
    title: snapshot.title,
    objective: snapshot.objective,
    scope: {
      in: snapshot.scope.in.map((scopeEntry) => scopeEntry),
      out: snapshot.scope.out.map((scopeEntry) => scopeEntry),
    },
    constraints: snapshot.constraints.map((constraint) => constraint),
    acceptance_criteria: projectAcceptanceCriteria(snapshot),
    state_revision: snapshot.state_revision,
    last_operation: snapshot.last_operation === null ? null : {
      operation_id: snapshot.last_operation.operation_id,
      input_digest: snapshot.last_operation.input_digest,
      basis_revision: snapshot.last_operation.basis_revision,
      resulting_revision: snapshot.last_operation.resulting_revision,
    },
    active_run: {
      run_id: snapshot.active_run.run_id,
      actor_id: snapshot.active_run.actor_id,
      started_by_handoff_id: snapshot.active_run.started_by_handoff_id,
    },
    evidence: snapshot.evidence.map((record) => projectEvidence(record, true)),
    current_handoff_id: snapshot.current_handoff_id,
    current_submission_id: snapshot.current_submission_id,
    current_decision_id: snapshot.current_decision_id,
  } satisfies JsonValue;
}

/** Project the immutable governed content that may substantively stale submissions. */
export function projectContent(snapshot: DossierSnapshot): JsonValue {
  return {
    dossier_id: snapshot.dossier_id,
    objective: snapshot.objective,
    scope: {
      in: snapshot.scope.in.map((scopeEntry) => scopeEntry),
      out: snapshot.scope.out.map((scopeEntry) => scopeEntry),
    },
    constraints: snapshot.constraints.map((constraint) => constraint),
    acceptance_criteria: projectAcceptanceCriteria(snapshot),
    evidence: snapshot.evidence.map((record) => projectEvidence(record, false)),
  } satisfies JsonValue;
}

/** Project deterministic observed evidence, preserving dossier evidence order. */
export function projectObservedEvidence(projection: ObservedEvidenceProjection): JsonValue {
  return {
    dossier_id: projection.dossier_id,
    content_digest: projection.content_digest,
    evidence_results: projection.evidence_results.map((result) => ({
      evidence_id: result.evidence_id,
      status: result.status,
      observed_artifact_digest: result.observed_artifact_digest,
      observed_artifact_size: result.observed_artifact_size,
      stable_limitation_codes: sortedCodes(result.stable_limitation_codes),
    } satisfies JsonValue)),
  } satisfies JsonValue;
}

/** Project stable check results without state, envelope, or diagnostic metadata. */
export function projectChecks(projection: ChecksProjection): JsonValue {
  return {
    dossier_id: projection.dossier_id,
    content_digest: projection.content_digest,
    observed_evidence_digest: projection.observed_evidence_digest,
    invariant_results: Array.from(projection.invariant_results)
      .sort((left, right) => compareAscii(left.code, right.code))
      .map((result) => ({ code: result.code, status: result.status } satisfies JsonValue)),
    criterion_results: projection.criterion_results.map((result) => ({
      criterion_id: result.criterion_id,
      status: result.status,
      supporting_evidence_ids: result.supporting_evidence_ids.map((evidenceId) => evidenceId),
    } satisfies JsonValue)),
    stable_warning_codes: sortedCodes(projection.stable_warning_codes),
    verdict: projection.verdict,
  } satisfies JsonValue;
}

/** Project every submission-envelope field except its self-referential digest. */
export function projectSubmission(envelope: SubmissionEnvelope): JsonValue {
  return {
    submission_id: envelope.submission_id,
    dossier_id: envelope.dossier_id,
    submitting_run_id: envelope.submitting_run_id,
    basis_revision: envelope.basis_revision,
    basis_state_digest: envelope.basis_state_digest,
    published_revision: envelope.published_revision,
    content_digest: envelope.content_digest,
    observed_evidence_digest: envelope.observed_evidence_digest,
    checks_digest: envelope.checks_digest,
    created_at: envelope.created_at,
    created_operation_id: envelope.created_operation_id,
  } satisfies JsonValue;
}
