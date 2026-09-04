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
import { decimalString, digest, revision, type ChecksProjection, type DossierSnapshot, type EvidenceRecord, type ObservedEvidenceProjection, type SubmissionEnvelope } from "../../src/protocol/types.js";

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
      { stage: "schema", code: "Z_INVARIANT", status: "passed" },
      { stage: "schema", code: "A_INVARIANT", status: "failed" },
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

test("checks projection orders invariants by protocol stage before ASCII code", () => {
  const checks: ChecksProjection = {
    dossier_id: "dossier-1",
    content_digest: primaryDigest,
    observed_evidence_digest: otherDigest,
    invariant_results: [
      { stage: "cross_file", code: "A_CROSS_FILE", status: "passed" },
      { stage: "schema", code: "Z_SCHEMA", status: "passed" },
      { stage: "schema", code: "A_SCHEMA", status: "passed" },
    ],
    criterion_results: [],
    stable_warning_codes: [],
    verdict: "passed",
  };

  const projected = projectChecks(checks) as unknown as { invariant_results: unknown };
  assert.deepEqual(projected.invariant_results, [
    { code: "A_SCHEMA", status: "passed" },
    { code: "Z_SCHEMA", status: "passed" },
    { code: "A_CROSS_FILE", status: "passed" },
  ]);
});

test("state and content mutation matrices include only their specified fields", () => {
  const stateInclusions: Array<[string, (snapshot: DossierSnapshot) => void]> = [
    ["dossier_id", (snapshot) => { snapshot.dossier_id = "dossier-2"; }],
    ["title", (snapshot) => { snapshot.title = "Another title"; }],
    ["objective", (snapshot) => { snapshot.objective = "Another objective"; }],
    ["scope", (snapshot) => { snapshot.scope.in[0] = "tests/**"; }],
    ["constraints", (snapshot) => { snapshot.constraints[0] = "networked"; }],
    ["acceptance_criteria", (snapshot) => { snapshot.acceptance_criteria[0]!.statement = "Changed"; }],
    ["state_revision", (snapshot) => { snapshot.state_revision = revision("8"); }],
    ["last_operation", (snapshot) => { snapshot.last_operation!.operation_id = "operation-9"; }],
    ["active_run", (snapshot) => { snapshot.active_run.actor_id = "actor-2"; }],
    ["evidence", (snapshot) => { snapshot.evidence[0]!.limitations[0] = "changed"; }],
    ["current_handoff_id", (snapshot) => { snapshot.current_handoff_id = null; }],
    ["current_submission_id", (snapshot) => { snapshot.current_submission_id = null; }],
    ["current_decision_id", (snapshot) => { snapshot.current_decision_id = "decision-1"; }],
  ];
  const stateExclusions: Array<[string, (snapshot: DossierSnapshot) => void]> = [
    ["state_digest", (snapshot) => { snapshot.state_digest = otherDigest; }],
  ];
  const contentInclusions: Array<[string, (snapshot: DossierSnapshot) => void]> = [
    ["dossier_id", (snapshot) => { snapshot.dossier_id = "dossier-2"; }],
    ["objective", (snapshot) => { snapshot.objective = "Another objective"; }],
    ["scope", (snapshot) => { snapshot.scope.out[0] = "coverage/**"; }],
    ["constraints", (snapshot) => { snapshot.constraints[0] = "networked"; }],
    ["acceptance_criteria", (snapshot) => { snapshot.acceptance_criteria[0]!.verification = "mechanical"; }],
  ];
  const contentExclusions: Array<[string, (snapshot: DossierSnapshot) => void]> = [
    ["title", (snapshot) => { snapshot.title = "Another title"; }],
    ["state_revision", (snapshot) => { snapshot.state_revision = revision("8"); }],
    ["state_digest", (snapshot) => { snapshot.state_digest = otherDigest; }],
    ["last_operation", (snapshot) => { snapshot.last_operation!.operation_id = "operation-9"; }],
    ["active_run", (snapshot) => { snapshot.active_run.actor_id = "actor-2"; }],
    ["current_handoff_id", (snapshot) => { snapshot.current_handoff_id = null; }],
    ["current_submission_id", (snapshot) => { snapshot.current_submission_id = null; }],
    ["current_decision_id", (snapshot) => { snapshot.current_decision_id = "decision-1"; }],
  ];

  for (const [field, mutate] of stateInclusions) {
    const changed = dossier();
    mutate(changed);
    assert.notEqual(digestProjection(projectState(dossier())), digestProjection(projectState(changed)), `state includes ${field}`);
  }
  for (const [field, mutate] of stateExclusions) {
    const changed = dossier();
    mutate(changed);
    assert.equal(digestProjection(projectState(dossier())), digestProjection(projectState(changed)), `state excludes ${field}`);
  }
  for (const [field, mutate] of contentInclusions) {
    const changed = dossier();
    mutate(changed);
    assert.notEqual(digestProjection(projectContent(dossier())), digestProjection(projectContent(changed)), `content includes ${field}`);
  }
  for (const [field, mutate] of contentExclusions) {
    const changed = dossier();
    mutate(changed);
    assert.equal(digestProjection(projectContent(dossier())), digestProjection(projectContent(changed)), `content excludes ${field}`);
  }
});

test("content mutation matrix excludes only captured_at from each evidence record", () => {
  const inclusions: Array<[string, (snapshot: DossierSnapshot) => void]> = [
    ["evidence_id", (snapshot) => { snapshot.evidence[0]!.evidence_id = "evidence-other"; }],
    ["criterion_ids", (snapshot) => { snapshot.evidence[0]!.criterion_ids[0] = "criterion-2"; }],
    ["freshness", (snapshot) => { snapshot.evidence[0]!.freshness = "immutable"; }],
    ["limitations", (snapshot) => { snapshot.evidence[0]!.limitations[0] = "changed"; }],
    ["kind", (snapshot) => {
      const record = snapshot.evidence[0]!;
      if (record.kind === "file" || record.kind === "command_result") {
        snapshot.evidence[0] = {
          evidence_id: record.evidence_id,
          criterion_ids: record.criterion_ids,
          captured_at: record.captured_at,
          freshness: record.freshness,
          limitations: record.limitations,
          kind: "command_result",
          location: { repository_relative_path: record.location.repository_relative_path },
          artifact_digest: record.artifact_digest,
          artifact_size: record.artifact_size,
        };
      }
    }],
    ["location", (snapshot) => {
      const record = snapshot.evidence[0]!;
      if (record.kind === "file" || record.kind === "command_result") record.location.repository_relative_path = "src/other.ts";
    }],
    ["artifact_digest", (snapshot) => {
      const record = snapshot.evidence[0]!;
      if (record.kind === "file" || record.kind === "command_result") record.artifact_digest = otherDigest;
    }],
    ["artifact_size", (snapshot) => {
      const record = snapshot.evidence[0]!;
      if (record.kind === "file" || record.kind === "command_result") record.artifact_size = decimalString("43");
    }],
  ];
  const baseline = digestProjection(projectContent(dossier()));
  for (const [field, mutate] of inclusions) {
    const changed = dossier();
    mutate(changed);
    assert.notEqual(baseline, digestProjection(projectContent(changed)), `content includes evidence ${field}`);
  }
  const changedTime = dossier();
  changedTime.evidence[0]!.captured_at = "2099-01-01T00:00:00Z";
  assert.equal(baseline, digestProjection(projectContent(changedTime)), "content excludes evidence captured_at");
});

test("observed, checks, and submission mutation matrices use only specified material", () => {
  const observed: ObservedEvidenceProjection = {
    dossier_id: "dossier-1", content_digest: primaryDigest,
    evidence_results: [{ evidence_id: "evidence-file", status: "current", observed_artifact_digest: primaryDigest, observed_artifact_size: decimalString("42"), stable_limitation_codes: ["Z_CODE", "A_CODE"] }],
  };
  const observedChanged = structuredClone(observed);
  observedChanged.evidence_results[0]!.status = "changed";
  assert.notEqual(digestProjection(projectObservedEvidence(observed)), digestProjection(projectObservedEvidence(observedChanged)), "observed evidence includes result status");
  const observedChangedDossier = structuredClone(observed);
  observedChangedDossier.dossier_id = "dossier-2";
  assert.notEqual(digestProjection(projectObservedEvidence(observed)), digestProjection(projectObservedEvidence(observedChangedDossier)), "observed evidence includes dossier_id");
  const observedChangedContent = structuredClone(observed);
  observedChangedContent.content_digest = otherDigest;
  assert.notEqual(digestProjection(projectObservedEvidence(observed)), digestProjection(projectObservedEvidence(observedChangedContent)), "observed evidence includes content_digest");
  const observedReorderedCodes = structuredClone(observed);
  observedReorderedCodes.evidence_results[0]!.stable_limitation_codes.reverse();
  assert.equal(digestProjection(projectObservedEvidence(observed)), digestProjection(projectObservedEvidence(observedReorderedCodes)), "observed stable codes are order-independent");

  const checks: ChecksProjection = {
    dossier_id: "dossier-1", content_digest: primaryDigest, observed_evidence_digest: otherDigest,
    invariant_results: [{ stage: "schema", code: "B_CODE", status: "passed" }, { stage: "schema", code: "A_CODE", status: "passed" }],
    criterion_results: [{ criterion_id: "criterion-2", status: "human_review_required", supporting_evidence_ids: ["evidence-human", "evidence-file"] }],
    stable_warning_codes: ["Z_WARNING", "A_WARNING"], verdict: "passed",
  };
  const checksChanged = structuredClone(checks);
  checksChanged.criterion_results[0]!.supporting_evidence_ids[0] = "evidence-other";
  assert.notEqual(digestProjection(projectChecks(checks)), digestProjection(projectChecks(checksChanged)), "checks includes supporting evidence");
  const checksReorderedWarnings = structuredClone(checks);
  checksReorderedWarnings.stable_warning_codes.reverse();
  assert.equal(digestProjection(projectChecks(checks)), digestProjection(projectChecks(checksReorderedWarnings)), "warning codes are order-independent");

  const envelope = submission();
  const changedEnvelope = submission();
  changedEnvelope.checks_digest = otherDigest;
  assert.notEqual(digestProjection(projectSubmission(envelope)), digestProjection(projectSubmission(changedEnvelope)), "submission includes checks_digest");
  const changedSelfDigest = submission();
  changedSelfDigest.submission_digest = primaryDigest;
  assert.equal(digestProjection(projectSubmission(envelope)), digestProjection(projectSubmission(changedSelfDigest)), "submission excludes submission_digest");
});

test("projections do not mutate caller-owned arrays while applying protocol order", () => {
  const snapshot = dossier();
  const observed: ObservedEvidenceProjection = {
    dossier_id: "dossier-1", content_digest: primaryDigest,
    evidence_results: [{ evidence_id: "evidence-file", status: "current", observed_artifact_digest: primaryDigest, observed_artifact_size: decimalString("42"), stable_limitation_codes: ["Z_CODE", "A_CODE"] }],
  };
  const checks: ChecksProjection = {
    dossier_id: "dossier-1", content_digest: primaryDigest, observed_evidence_digest: otherDigest,
    invariant_results: [{ stage: "schema", code: "Z_CODE", status: "passed" }, { stage: "schema", code: "A_CODE", status: "passed" }],
    criterion_results: [{ criterion_id: "criterion-2", status: "human_review_required", supporting_evidence_ids: ["evidence-human", "evidence-file"] }],
    stable_warning_codes: ["Z_WARNING", "A_WARNING"], verdict: "passed",
  };

  projectState(snapshot);
  projectContent(snapshot);
  projectObservedEvidence(observed);
  projectChecks(checks);

  assert.deepEqual(snapshot.scope.in, ["src/**"]);
  assert.deepEqual(snapshot.constraints, ["offline"]);
  assert.deepEqual(snapshot.acceptance_criteria.map((criterion) => criterion.criterion_id), ["criterion-2", "criterion-1"]);
  assert.deepEqual(snapshot.evidence.map((record) => record.evidence_id), ["evidence-file", "evidence-human"]);
  assert.deepEqual(snapshot.evidence[0]!.criterion_ids, ["criterion-1"]);
  assert.deepEqual(snapshot.evidence[0]!.limitations, ["observed-later"]);
  assert.deepEqual(observed.evidence_results[0]!.stable_limitation_codes, ["Z_CODE", "A_CODE"]);
  assert.deepEqual(checks.invariant_results.map((result) => result.code), ["Z_CODE", "A_CODE"]);
  assert.deepEqual(checks.criterion_results[0]!.supporting_evidence_ids, ["evidence-human", "evidence-file"]);
  assert.deepEqual(checks.stable_warning_codes, ["Z_WARNING", "A_WARNING"]);
});

test("observed evidence and checks preserve only protocol-significant result ordering", () => {
  const observed: ObservedEvidenceProjection = {
    dossier_id: "dossier-1", content_digest: primaryDigest,
    evidence_results: [
      { evidence_id: "evidence-file", status: "current", observed_artifact_digest: primaryDigest, observed_artifact_size: decimalString("42"), stable_limitation_codes: [] },
      { evidence_id: "evidence-human", status: "human_review_required", observed_artifact_digest: null, observed_artifact_size: null, stable_limitation_codes: [] },
    ],
  };
  const reorderedObserved = structuredClone(observed);
  reorderedObserved.evidence_results.reverse();
  assert.notEqual(digestProjection(projectObservedEvidence(observed)), digestProjection(projectObservedEvidence(reorderedObserved)), "evidence result order is significant");

  const checks: ChecksProjection = {
    dossier_id: "dossier-1", content_digest: primaryDigest, observed_evidence_digest: otherDigest,
    invariant_results: [{ stage: "schema", code: "A_CODE", status: "passed" }, { stage: "schema", code: "Z_CODE", status: "passed" }],
    criterion_results: [
      { criterion_id: "criterion-2", status: "human_review_required", supporting_evidence_ids: ["evidence-human"] },
      { criterion_id: "criterion-1", status: "mechanically_satisfied", supporting_evidence_ids: ["evidence-file"] },
    ],
    stable_warning_codes: [], verdict: "passed",
  };
  const reorderedInvariants = structuredClone(checks);
  reorderedInvariants.invariant_results.reverse();
  assert.equal(digestProjection(projectChecks(checks)), digestProjection(projectChecks(reorderedInvariants)), "invariants are ordered by stage and code");
  const reorderedCriteria = structuredClone(checks);
  reorderedCriteria.criterion_results.reverse();
  assert.notEqual(digestProjection(projectChecks(checks)), digestProjection(projectChecks(reorderedCriteria)), "criterion order is significant");
});

test("checks and submissions mutation matrices include every emitted top-level field", () => {
  const checks: ChecksProjection = {
    dossier_id: "dossier-1", content_digest: primaryDigest, observed_evidence_digest: otherDigest,
    invariant_results: [{ stage: "schema", code: "A_CODE", status: "passed" }],
    criterion_results: [{ criterion_id: "criterion-1", status: "mechanically_satisfied", supporting_evidence_ids: ["evidence-file"] }],
    stable_warning_codes: ["A_WARNING"], verdict: "passed",
  };
  const checkInclusions: Array<[string, (value: ChecksProjection) => void]> = [
    ["dossier_id", (value) => { value.dossier_id = "dossier-2"; }],
    ["content_digest", (value) => { value.content_digest = otherDigest; }],
    ["observed_evidence_digest", (value) => { value.observed_evidence_digest = primaryDigest; }],
    ["invariant_results", (value) => { value.invariant_results[0]!.status = "failed"; }],
    ["criterion_results", (value) => { value.criterion_results[0]!.status = "failed"; }],
    ["stable_warning_codes", (value) => { value.stable_warning_codes[0] = "B_WARNING"; }],
    ["verdict", (value) => { value.verdict = "failed"; }],
  ];
  const checksDigest = digestProjection(projectChecks(checks));
  for (const [field, mutate] of checkInclusions) {
    const changed = structuredClone(checks);
    mutate(changed);
    assert.notEqual(checksDigest, digestProjection(projectChecks(changed)), `checks includes ${field}`);
  }

  const envelopeInclusions: Array<[string, (value: SubmissionEnvelope) => void]> = [
    ["submission_id", (value) => { value.submission_id = "submission-2"; }],
    ["dossier_id", (value) => { value.dossier_id = "dossier-2"; }],
    ["submitting_run_id", (value) => { value.submitting_run_id = "run-2"; }],
    ["basis_revision", (value) => { value.basis_revision = revision("9"); }],
    ["basis_state_digest", (value) => { value.basis_state_digest = otherDigest; }],
    ["published_revision", (value) => { value.published_revision = revision("9"); }],
    ["content_digest", (value) => { value.content_digest = otherDigest; }],
    ["observed_evidence_digest", (value) => { value.observed_evidence_digest = primaryDigest; }],
    ["checks_digest", (value) => { value.checks_digest = otherDigest; }],
    ["created_at", (value) => { value.created_at = "2099-01-01T00:00:00Z"; }],
    ["created_operation_id", (value) => { value.created_operation_id = "operation-9"; }],
  ];
  const envelopeDigest = digestProjection(projectSubmission(submission()));
  for (const [field, mutate] of envelopeInclusions) {
    const changed = submission();
    mutate(changed);
    assert.notEqual(envelopeDigest, digestProjection(projectSubmission(changed)), `submission includes ${field}`);
  }
});

test("content excludes captured_at and includes every emitted field for all evidence kinds", () => {
  const snapshot = dossier();
  snapshot.evidence = [
    snapshot.evidence[0]!,
    {
      evidence_id: "evidence-command",
      criterion_ids: ["criterion-1"],
      captured_at: "2026-09-04T00:00:01Z",
      freshness: "recompute_on_check",
      limitations: ["command-limitation"],
      kind: "command_result",
      location: { repository_relative_path: "scripts/check.ps1" },
      artifact_digest: otherDigest,
      artifact_size: decimalString("43"),
    },
    {
      evidence_id: "evidence-external",
      criterion_ids: ["criterion-2"],
      captured_at: "2026-09-04T00:00:02Z",
      freshness: "human_review",
      limitations: ["external-limitation"],
      kind: "external_reference",
      location: { uri: "https://example.test/reference" },
    },
    {
      evidence_id: "evidence-human",
      criterion_ids: ["criterion-2"],
      captured_at: "2026-09-04T00:00:03Z",
      freshness: "human_review",
      limitations: ["human-limitation"],
      kind: "human_observation",
      location: { statement: "A reviewer observed the result." },
    },
  ];
  const baseline = digestProjection(projectContent(snapshot));

  for (const [index, kind] of ["file", "command_result", "external_reference", "human_observation"].entries()) {
    const changed = structuredClone(snapshot);
    changed.evidence[index]!.captured_at = "2099-01-01T00:00:00Z";
    assert.equal(baseline, digestProjection(projectContent(changed)), `content excludes ${kind} captured_at`);
  }

  const commonMutations: Array<[string, (snapshot: DossierSnapshot, index: number) => void]> = [
    ["evidence_id", (value, index) => { value.evidence[index]!.evidence_id = `evidence-changed-${index}`; }],
    ["criterion_ids", (value, index) => { value.evidence[index]!.criterion_ids[0] = `criterion-changed-${index}`; }],
    ["freshness", (value, index) => { value.evidence[index]!.freshness = "immutable"; }],
    ["limitations", (value, index) => { value.evidence[index]!.limitations[0] = `changed-${index}`; }],
  ];
  for (const [field, mutate] of commonMutations) {
    for (const index of [0, 1, 2, 3]) {
      const changed = structuredClone(snapshot);
      mutate(changed, index);
      assert.notEqual(baseline, digestProjection(projectContent(changed)), `content includes ${field} for evidence ${index}`);
    }
  }

  const changedFilePath = structuredClone(snapshot);
  if (changedFilePath.evidence[0]?.kind === "file") changedFilePath.evidence[0].location.repository_relative_path = "src/changed.ts";
  assert.notEqual(baseline, digestProjection(projectContent(changedFilePath)), "content includes file location");
  const changedCommandPath = structuredClone(snapshot);
  if (changedCommandPath.evidence[1]?.kind === "command_result") changedCommandPath.evidence[1].location.repository_relative_path = "scripts/changed.ps1";
  assert.notEqual(baseline, digestProjection(projectContent(changedCommandPath)), "content includes command-result location");
  const changedExternalUri = structuredClone(snapshot);
  if (changedExternalUri.evidence[2]?.kind === "external_reference") changedExternalUri.evidence[2].location.uri = "https://example.test/changed";
  assert.notEqual(baseline, digestProjection(projectContent(changedExternalUri)), "content includes external-reference location");
  const changedHumanStatement = structuredClone(snapshot);
  if (changedHumanStatement.evidence[3]?.kind === "human_observation") changedHumanStatement.evidence[3].location.statement = "The observation changed.";
  assert.notEqual(baseline, digestProjection(projectContent(changedHumanStatement)), "content includes human-observation location");

  for (const index of [0, 1]) {
    const changedDigest = structuredClone(snapshot);
    const record = changedDigest.evidence[index]!;
    if (record.kind === "file" || record.kind === "command_result") record.artifact_digest = index === 0 ? otherDigest : primaryDigest;
    assert.notEqual(baseline, digestProjection(projectContent(changedDigest)), `content includes artifact_digest for evidence ${index}`);
    const changedSize = structuredClone(snapshot);
    const sizedRecord = changedSize.evidence[index]!;
    if (sizedRecord.kind === "file" || sizedRecord.kind === "command_result") sizedRecord.artifact_size = decimalString(index === 0 ? "44" : "42");
    assert.notEqual(baseline, digestProjection(projectContent(changedSize)), `content includes artifact_size for evidence ${index}`);
  }
});

test("content projects the discriminator for every evidence variant", () => {
  const common = {
    evidence_id: "evidence-1",
    criterion_ids: ["criterion-1"],
    captured_at: "2026-09-04T00:00:00Z",
    freshness: "recompute_on_check" as const,
    limitations: ["limitation-1"],
  };
  const variants: EvidenceRecord[] = [
    {
      ...common,
      kind: "file",
      location: { repository_relative_path: "src/index.ts" },
      artifact_digest: primaryDigest,
      artifact_size: decimalString("42"),
    },
    {
      ...common,
      kind: "command_result",
      location: { repository_relative_path: "src/index.ts" },
      artifact_digest: primaryDigest,
      artifact_size: decimalString("42"),
    },
    {
      ...common,
      kind: "external_reference",
      location: { uri: "https://example.test/reference" },
    },
    {
      ...common,
      kind: "human_observation",
      location: { statement: "The reviewer observed the result." },
    },
  ];
  const projectedKinds: string[] = [];
  const digests: string[] = [];

  for (const record of variants) {
    const snapshot = dossier();
    snapshot.evidence = [record];
    const projected = projectContent(snapshot) as unknown as { evidence: Array<{ kind: string }> };
    projectedKinds.push(projected.evidence[0]!.kind);
    digests.push(digestProjection(projectContent(snapshot)));
  }

  assert.deepEqual(projectedKinds, ["file", "command_result", "external_reference", "human_observation"]);
  assert.notEqual(digests[0], digests[1], "file and command_result differ only by kind in their projected records");
  assert.equal(new Set(digests).size, 4, "each valid tagged evidence variant has a distinct content digest");
});
