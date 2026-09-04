import assert from "node:assert/strict";
import test from "node:test";
import { digestProjection } from "../../src/protocol/canonical.js";
import {
  projectChecks,
  projectContent,
  projectObservedEvidence,
  projectState,
  projectSubmission,
} from "../../src/protocol/projections.js";
import { decimalString, digest, revision, type ChecksProjection, type DossierSnapshot, type ObservedEvidenceProjection, type SubmissionEnvelope } from "../../src/protocol/types.js";

const primaryDigest = digest("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
const otherDigest = digest("sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");

function dossier(): DossierSnapshot {
  return {
    dossier_id: "dossier-1",
    title: "Display title",
    objective: "Prove the projection contract",
    scope: { in: ["src/**"], out: ["dist/**"] },
    constraints: ["offline"],
    acceptance_criteria: [
      { criterion_id: "criterion-2", statement: "Review evidence", verification: "recorded_human_review" },
      { criterion_id: "criterion-1", statement: "Pass checks", verification: "mechanical" },
    ],
    state_revision: revision("7"),
    state_digest: primaryDigest,
    last_operation: {
      operation_id: "operation-1",
      input_digest: primaryDigest,
      basis_revision: revision("6"),
      resulting_revision: revision("7"),
    },
    active_run: { run_id: "run-1", actor_id: "actor-1", started_by_handoff_id: null },
    evidence: [
      {
        evidence_id: "evidence-file",
        criterion_ids: ["criterion-1"],
        captured_at: "2026-09-04T00:00:00Z",
        freshness: "recompute_on_check",
        limitations: ["observed-later"],
        kind: "file",
        location: { repository_relative_path: "src/index.ts" },
        artifact_digest: primaryDigest,
        artifact_size: decimalString("42"),
      },
      {
        evidence_id: "evidence-human",
        criterion_ids: ["criterion-2"],
        captured_at: "2026-09-04T00:00:01Z",
        freshness: "human_review",
        limitations: ["recorded-claim"],
        kind: "human_observation",
        location: { statement: "I reviewed it." },
      },
    ],
    current_handoff_id: "handoff-1",
    current_submission_id: "submission-1",
    current_decision_id: null,
  };
}

function submission(): SubmissionEnvelope {
  return {
    submission_id: "submission-1",
    dossier_id: "dossier-1",
    submitting_run_id: "run-1",
    basis_revision: revision("7"),
    basis_state_digest: primaryDigest,
    published_revision: revision("8"),
    content_digest: primaryDigest,
    observed_evidence_digest: otherDigest,
    checks_digest: primaryDigest,
    created_at: "2026-09-04T00:00:02Z",
    created_operation_id: "operation-2",
    submission_digest: otherDigest,
  };
}

test("state projection contains every stored dossier field except state_digest", () => {
  const snapshot = dossier();
  const projected = projectState(snapshot);

  assert.deepEqual(projected, {
    dossier_id: "dossier-1",
    title: "Display title",
    objective: "Prove the projection contract",
    scope: { in: ["src/**"], out: ["dist/**"] },
    constraints: ["offline"],
    acceptance_criteria: [
      { criterion_id: "criterion-2", statement: "Review evidence", verification: "recorded_human_review" },
      { criterion_id: "criterion-1", statement: "Pass checks", verification: "mechanical" },
    ],
    state_revision: "7",
    last_operation: {
      operation_id: "operation-1",
      input_digest: primaryDigest,
      basis_revision: "6",
      resulting_revision: "7",
    },
    active_run: { run_id: "run-1", actor_id: "actor-1", started_by_handoff_id: null },
    evidence: [
      {
        evidence_id: "evidence-file",
        criterion_ids: ["criterion-1"],
        captured_at: "2026-09-04T00:00:00Z",
        freshness: "recompute_on_check",
        limitations: ["observed-later"],
        kind: "file",
        location: { repository_relative_path: "src/index.ts" },
        artifact_digest: primaryDigest,
        artifact_size: "42",
      },
      {
        evidence_id: "evidence-human",
        criterion_ids: ["criterion-2"],
        captured_at: "2026-09-04T00:00:01Z",
        freshness: "human_review",
        limitations: ["recorded-claim"],
        kind: "human_observation",
        location: { statement: "I reviewed it." },
      },
    ],
    current_handoff_id: "handoff-1",
    current_submission_id: "submission-1",
    current_decision_id: null,
  });
});

test("content projection ignores captured_at but includes declared artifact data", () => {
  const first = projectContent(dossier());
  const changedTime = dossier();
  changedTime.evidence[0]!.captured_at = "2099-01-01T00:00:00Z";
  const changedArtifact = dossier();
  if (changedArtifact.evidence[0]?.kind === "file") changedArtifact.evidence[0].artifact_digest = otherDigest;

  assert.deepEqual(first, projectContent(changedTime));
  assert.notDeepEqual(first, projectContent(changedArtifact));
});

test("content projection preserves declared evidence and criterion order", () => {
  const content = projectContent(dossier());
  assert.deepEqual(content, {
    dossier_id: "dossier-1",
    objective: "Prove the projection contract",
    scope: { in: ["src/**"], out: ["dist/**"] },
    constraints: ["offline"],
    acceptance_criteria: [
      { criterion_id: "criterion-2", statement: "Review evidence", verification: "recorded_human_review" },
      { criterion_id: "criterion-1", statement: "Pass checks", verification: "mechanical" },
    ],
    evidence: [
      {
        evidence_id: "evidence-file",
        criterion_ids: ["criterion-1"],
        freshness: "recompute_on_check",
        limitations: ["observed-later"],
        kind: "file",
        location: { repository_relative_path: "src/index.ts" },
        artifact_digest: primaryDigest,
        artifact_size: "42",
      },
      {
        evidence_id: "evidence-human",
        criterion_ids: ["criterion-2"],
        freshness: "human_review",
        limitations: ["recorded-claim"],
        kind: "human_observation",
        location: { statement: "I reviewed it." },
      },
    ],
  });
});

test("observed evidence projection sorts stable limitation codes without reordering evidence", () => {
  const observed: ObservedEvidenceProjection = {
    dossier_id: "dossier-1",
    content_digest: primaryDigest,
    evidence_results: [
      {
        evidence_id: "evidence-file",
        status: "current",
        observed_artifact_digest: primaryDigest,
        observed_artifact_size: decimalString("42"),
        stable_limitation_codes: ["Z_CODE", "A_CODE"],
      },
      {
        evidence_id: "evidence-human",
        status: "human_review_required",
        observed_artifact_digest: null,
        observed_artifact_size: null,
        stable_limitation_codes: ["B_CODE"],
      },
    ],
  };

  assert.deepEqual(projectObservedEvidence(observed), {
    dossier_id: "dossier-1",
    content_digest: primaryDigest,
    evidence_results: [
      {
        evidence_id: "evidence-file",
        status: "current",
        observed_artifact_digest: primaryDigest,
        observed_artifact_size: "42",
        stable_limitation_codes: ["A_CODE", "Z_CODE"],
      },
      {
        evidence_id: "evidence-human",
        status: "human_review_required",
        observed_artifact_digest: null,
        observed_artifact_size: null,
        stable_limitation_codes: ["B_CODE"],
      },
    ],
  });
});

test("checks projection sorts stable codes and preserves criterion order", () => {
  const checks: ChecksProjection = {
    dossier_id: "dossier-1",
    content_digest: primaryDigest,
    observed_evidence_digest: otherDigest,
    invariant_results: [
      { code: "Z_INVARIANT", status: "passed" },
      { code: "A_INVARIANT", status: "failed" },
    ],
    criterion_results: [
      { criterion_id: "criterion-2", status: "human_review_required", supporting_evidence_ids: ["evidence-human"] },
      { criterion_id: "criterion-1", status: "mechanically_satisfied", supporting_evidence_ids: ["evidence-file"] },
    ],
    stable_warning_codes: ["Z_WARNING", "A_WARNING"],
    verdict: "failed",
  };
  assert.deepEqual(projectChecks(checks), {
    dossier_id: "dossier-1",
    content_digest: primaryDigest,
    observed_evidence_digest: otherDigest,
    invariant_results: [
      { code: "A_INVARIANT", status: "failed" },
      { code: "Z_INVARIANT", status: "passed" },
    ],
    criterion_results: checks.criterion_results,
    stable_warning_codes: ["A_WARNING", "Z_WARNING"],
    verdict: "failed",
  });
});

test("a human decision pointer update changes state but not covered content", () => {
  const beforeDecision = dossier();
  const afterDecision = dossier();
  afterDecision.current_decision_id = "decision-1";

  assert.notEqual(digestProjection(projectState(beforeDecision)), digestProjection(projectState(afterDecision)));
  assert.equal(digestProjection(projectContent(beforeDecision)), digestProjection(projectContent(afterDecision)));
});

test("submission projection excludes only its self digest", () => {
  const envelope = submission();
  assert.deepEqual(projectSubmission(envelope), {
    submission_id: "submission-1",
    dossier_id: "dossier-1",
    submitting_run_id: "run-1",
    basis_revision: "7",
    basis_state_digest: primaryDigest,
    published_revision: "8",
    content_digest: primaryDigest,
    observed_evidence_digest: otherDigest,
    checks_digest: primaryDigest,
    created_at: "2026-09-04T00:00:02Z",
    created_operation_id: "operation-2",
  });
  const changed = submission();
  changed.created_operation_id = "operation-3";
  assert.notEqual(digestProjection(projectSubmission(envelope)), digestProjection(projectSubmission(changed)));
});
