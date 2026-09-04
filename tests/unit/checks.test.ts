import assert from "node:assert/strict";
import test from "node:test";
import { digestProjection } from "../../src/protocol/canonical.js";
import { buildChecksProjection } from "../../src/protocol/checks.js";
import { projectContent, projectObservedEvidence, projectState } from "../../src/protocol/projections.js";
import { evaluateTransition } from "../../src/protocol/transitions.js";
import { digest, revision, type DossierSnapshot, type ObservedEvidenceProjection } from "../../src/protocol/types.js";

const artifactDigest = digest(`sha256:${"1".repeat(64)}`);

function fixed(snapshot: Omit<DossierSnapshot, "state_digest">): DossierSnapshot {
  const candidate = { ...snapshot, state_digest: digestProjection({}) };
  return { ...candidate, state_digest: digestProjection(projectState(candidate)) };
}

function dossier(verification: "mechanical" | "recorded_human_review", evidence: DossierSnapshot["evidence"]): DossierSnapshot {
  return fixed({
    dossier_id: "dossier-a",
    title: "Evidence checks",
    objective: "Evaluate one criterion",
    scope: { in: ["artifact"], out: [] },
    constraints: [],
    acceptance_criteria: [{ criterion_id: "criterion-a", statement: "Evidence exists", verification }],
    state_revision: revision("0"),
    last_operation: null,
    active_run: { run_id: "run-a", actor_id: "actor-a", started_by_handoff_id: null },
    evidence,
    current_handoff_id: null,
    current_submission_id: null,
    current_decision_id: null,
  });
}

function observation(snapshot: DossierSnapshot, status: "current" | "changed" | "human_review_required"): ObservedEvidenceProjection {
  const mechanical = status !== "human_review_required";
  const result: ObservedEvidenceProjection = {
    dossier_id: snapshot.dossier_id,
    content_digest: digestProjection(projectContent(snapshot)),
    evidence_results: snapshot.evidence.map((record) => ({
      evidence_id: record.evidence_id,
      status,
      observed_artifact_digest: mechanical ? artifactDigest : null,
      observed_artifact_size: mechanical ? "3" as never : null,
      stable_limitation_codes: [],
    })),
  };
  return result;
}

test("a mechanical criterion cannot be satisfied by a human observation", () => {
  const snapshot = dossier("mechanical", [{
    evidence_id: "evidence-human",
    criterion_ids: ["criterion-a"],
    kind: "human_observation",
    location: { statement: "Looks correct" },
    captured_at: "2026-09-04T03:02:01Z",
    freshness: "human_review",
    limitations: [],
  }]);

  const report = buildChecksProjection(snapshot, observation(snapshot, "human_review_required"), true);

  assert.equal(report.verdict, "failed");
  assert.deepEqual(report.criterion_results, [{
    criterion_id: "criterion-a",
    status: "failed",
    supporting_evidence_ids: [],
  }]);
});

test("a linked recorded-human criterion remains human review required without failing checks", () => {
  const snapshot = dossier("recorded_human_review", [{
    evidence_id: "evidence-human",
    criterion_ids: ["criterion-a"],
    kind: "human_observation",
    location: { statement: "Reviewed visually" },
    captured_at: "2026-09-04T03:02:01Z",
    freshness: "human_review",
    limitations: [],
  }]);

  const report = buildChecksProjection(snapshot, observation(snapshot, "human_review_required"), true);

  assert.equal(report.verdict, "passed");
  assert.deepEqual(report.criterion_results, [{
    criterion_id: "criterion-a",
    status: "human_review_required",
    supporting_evidence_ids: ["evidence-human"],
  }]);
});

test("linked mechanical evidence records are alternatives and only current records support the criterion", () => {
  const snapshot = dossier("mechanical", [
    {
      evidence_id: "evidence-changed",
      criterion_ids: ["criterion-a"],
      kind: "file",
      location: { repository_relative_path: "artifacts/old.txt" },
      captured_at: "2026-09-04T03:02:01Z",
      artifact_digest: artifactDigest,
      artifact_size: "3" as never,
      freshness: "recompute_on_check",
      limitations: [],
    },
    {
      evidence_id: "evidence-current",
      criterion_ids: ["criterion-a"],
      kind: "command_result",
      location: { repository_relative_path: "artifacts/current.txt" },
      captured_at: "2026-09-04T03:02:01Z",
      artifact_digest: artifactDigest,
      artifact_size: "3" as never,
      freshness: "recompute_on_check",
      limitations: [],
    },
  ]);
  const observed = observation(snapshot, "current");
  observed.evidence_results[0]!.status = "changed";

  const report = buildChecksProjection(snapshot, observed, true);

  assert.equal(report.verdict, "failed");
  assert.deepEqual(report.criterion_results[0], {
    criterion_id: "criterion-a",
    status: "mechanically_satisfied",
    supporting_evidence_ids: ["evidence-current"],
  });
});

test("an unknown criterion link fails the evidence-integrity stage", () => {
  const snapshot = dossier("mechanical", [{
    evidence_id: "evidence-current",
    criterion_ids: ["criterion-a", "criterion-unknown"],
    kind: "file",
    location: { repository_relative_path: "artifact.txt" },
    captured_at: "2026-09-04T03:02:01Z",
    artifact_digest: artifactDigest,
    artifact_size: "3" as never,
    freshness: "recompute_on_check",
    limitations: [],
  }]);

  const report = buildChecksProjection(snapshot, observation(snapshot, "current"), true);

  assert.equal(report.verdict, "failed");
  assert.equal(
    report.invariant_results.find((result) => result.code === "CASE_I_EVIDENCE_LINKS")?.status,
    "failed",
  );
});

test("check projections carry closed stages in protocol then ASCII code order", () => {
  const snapshot = dossier("mechanical", []);
  const observed: ObservedEvidenceProjection = {
    dossier_id: snapshot.dossier_id,
    content_digest: digestProjection(projectContent(snapshot)),
    evidence_results: [],
  };

  const report = buildChecksProjection(snapshot, observed, false);

  assert.deepEqual(report.invariant_results.map(({ stage, code }) => [stage, code]), [
    ["parse", "CASE_I_PARSE"],
    ["schema", "CASE_I_SCHEMA"],
    ["cross_file", "CASE_I_STATE"],
    ["evidence_safety", "CASE_I_EVIDENCE_SAFETY"],
    ["evidence_integrity", "CASE_I_EVIDENCE_INTEGRITY"],
    ["evidence_integrity", "CASE_I_EVIDENCE_LINKS"],
    ["envelope_integrity", "CASE_I_ENVELOPE_INTEGRITY"],
    ["derived_status", "CASE_I_DERIVED_STATUS"],
  ]);
  assert.equal(report.observed_evidence_digest, digestProjection(projectObservedEvidence(observed)));
});

test("only the active run may add evidence and fixed-brief edits are not M0 transitions", () => {
  const snapshot = dossier("mechanical", []);

  assert.deepEqual(evaluateTransition(snapshot, { kind: "add_evidence", run_id: "run-a" }), {
    allowed: true,
    code: "CASE_OK",
  });
  assert.deepEqual(evaluateTransition(snapshot, { kind: "add_evidence", run_id: "run-old" }), {
    allowed: false,
    code: "CASE_E_ACTOR",
  });
  assert.deepEqual(evaluateTransition(snapshot, { kind: "edit_brief" } as never), {
    allowed: false,
    code: "CASE_E_TRANSITION",
  });
});
