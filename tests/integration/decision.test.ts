import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { DECISION_CONFIRMATION_PHRASE, RECORDED_IDENTITY_LIMITATION } from "../../src/cli/confirm.js";
import { digestProjection } from "../../src/protocol/canonical.js";
import { projectState } from "../../src/protocol/projections.js";
import { SchemaRegistry } from "../../src/protocol/schema-registry.js";
import type { DecisionEnvelope, DossierSnapshot, MutationPrecondition, SubmissionEnvelope } from "../../src/protocol/types.js";
import { controlledAtomicFs } from "../helpers/fault-port.js";
import { nodePathInspection } from "../../src/storage/paths.js";
import { CaseStore } from "../../src/storage/store.js";
import {
  createDossier,
  showDossier,
  type DossierDirectoryPublicationPort,
  type WorkflowPorts,
} from "../../src/workflows/dossier.js";
import { addEvidence } from "../../src/workflows/evidence.js";
import { createSubmission } from "../../src/workflows/submission.js";
import { recordDecision, type DecisionPorts, type DecisionRequest } from "../../src/workflows/decision.js";
import { ScriptedConfirmationPort } from "../helpers/confirmation-port.js";

const timestamp = "2026-09-04T03:02:01Z";

async function fixture(t: TestContext): Promise<{
  root: string;
  ports: WorkflowPorts;
  snapshot: DossierSnapshot;
  submission: SubmissionEnvelope;
  artifactPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "case-agent-decision-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".case-agent", "dossiers"), { recursive: true });
  await mkdir(join(root, ".case-agent", "locks"), { recursive: true });
  const schemas = await SchemaRegistry.load(join(process.cwd(), "schemas"));
  const dossiers: DossierDirectoryPublicationPort = {
    profile: { supported: true, profile: "test", crash_safety: "process-crash", physical_durability: false },
    async publishCreateOnce(relativeDirectory, contents) {
      const target = resolve(root, relativeDirectory);
      const staging = `${target}.staging`;
      await mkdir(staging);
      for (const relativePath of contents.directories) await mkdir(join(staging, relativePath));
      for (const [relativePath, bytes] of Object.entries(contents.files)) {
        const path = join(staging, relativePath);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes, { flag: "wx" });
      }
      await rename(staging, target);
    },
  };
  let guardNumber = 0;
  const store = new CaseStore(root, schemas);
  const ports: WorkflowPorts = {
    repository_root: root,
    store,
    schemas,
    evidenceFs: nodePathInspection,
    fs: controlledAtomicFs(root),
    dossiers,
    processIdentity: {
      current: async () => ({ profile: "test", pid: "1", process_started_at: timestamp }),
      verifyTerminated: async () => "terminated",
    },
    clock: { now: () => timestamp, isPossiblyStale: () => false },
    ids: {
      createGuardId: () => `guard-${++guardNumber}`,
      tempIdFor: (guardId) => `temp-${guardId}`,
      envelopeIdFor: (kind, operationId) => `${kind}-${operationId}`,
      createDossierId: () => "dossier-a",
      createRunId: () => "run-a",
      evidenceIdFor: (operationId) => `evidence-${operationId}`,
    },
  };
  const created = await createDossier({
    operation_id: "op-create",
    actor_id: "actor-a",
    title: "Record exact decision",
    objective: "Bind a recorded human decision to exact work",
    scope: { in: ["artifact"], out: [] },
    constraints: ["local-only"],
    acceptance_criteria: [
      { criterion_id: "criterion-a", statement: "Artifact remains exact", verification: "mechanical" },
      { criterion_id: "criterion-b", statement: "Human reviews the exact artifact", verification: "recorded_human_review" },
    ],
  }, ports);
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("fixture dossier creation failed");
  const artifactPath = join(root, "artifacts", "result.txt");
  await mkdir(dirname(artifactPath));
  await writeFile(artifactPath, "current");
  const fileAdded = await addEvidence({
    dossier_id: created.data.snapshot.dossier_id,
    expected_revision: created.data.snapshot.state_revision,
    expected_state_digest: created.data.snapshot.state_digest,
    operation_id: "op-add-file",
    run_id: "run-a",
    criterion_ids: ["criterion-a"],
    kind: "file",
    location: { repository_relative_path: "artifacts/result.txt" },
    freshness: "recompute_on_check",
    limitations: [],
  }, ports);
  assert.equal(fileAdded.ok, true);
  if (!fileAdded.ok) throw new Error("fixture file evidence failed");
  const reviewAdded = await addEvidence({
    dossier_id: "dossier-a",
    expected_revision: fileAdded.data.snapshot.state_revision,
    expected_state_digest: fileAdded.data.snapshot.state_digest,
    operation_id: "op-add-review",
    run_id: "run-a",
    criterion_ids: ["criterion-b"],
    kind: "human_observation",
    location: { statement: "Ready for exact review" },
    freshness: "human_review",
    limitations: ["Recorded claim only"],
  }, ports);
  assert.equal(reviewAdded.ok, true);
  if (!reviewAdded.ok) throw new Error("fixture review evidence failed");
  const submitted = await createSubmission({
    dossier_id: "dossier-a",
    expected_revision: reviewAdded.data.snapshot.state_revision,
    expected_state_digest: reviewAdded.data.snapshot.state_digest,
    operation_id: "op-submit",
    submitting_run_id: "run-a",
  }, ports);
  assert.equal(submitted.ok, true);
  if (!submitted.ok) throw new Error("fixture submission failed");
  return {
    root,
    ports,
    snapshot: await ports.store.loadDossier("dossier-a"),
    submission: submitted.data,
    artifactPath,
  };
}

function decisionRequest(
  snapshot: DossierSnapshot,
  submission: SubmissionEnvelope,
  operationId = "op-decide",
): DecisionRequest & MutationPrecondition {
  return {
    dossier_id: snapshot.dossier_id,
    expected_revision: snapshot.state_revision,
    expected_state_digest: snapshot.state_digest,
    operation_id: operationId,
    submission_id: submission.submission_id,
    submission_digest: submission.submission_digest,
    decision: "accepted",
    reviewer_id: "reviewer-a",
    criteria_reviewed: ["criterion-a", "criterion-b"],
    comment: "Reviewed exact submission",
  };
}

test("decision can target only the current submission", async (t) => {
  const { ports, snapshot, submission } = await fixture(t);
  const confirmation = new ScriptedConfirmationPort(true);
  const result = await recordDecision({
    ...decisionRequest(snapshot, submission),
    submission_id: "submission-older",
  }, { ...ports, confirmation });

  assert.equal(result.command, "decision.accept");
  assert.equal(result.code, "CASE_E_CONFLICT");
  assert.equal(confirmation.decisionConfirmations.length, 0);
});

test("decision requires the exact current submission digest", async (t) => {
  const { ports, snapshot, submission } = await fixture(t);
  const confirmation = new ScriptedConfirmationPort(true);

  const result = await recordDecision({
    ...decisionRequest(snapshot, submission),
    submission_digest: digestProjection({ wrong: "submission" }),
  }, { ...ports, confirmation });

  assert.equal(result.command, "decision.accept");
  assert.equal(result.code, "CASE_E_CONFLICT");
  assert.equal(confirmation.decisionConfirmations.length, 0);
});

for (const [name, criteriaReviewed] of [
  ["omitted", ["criterion-a"]],
  ["duplicated", ["criterion-a", "criterion-a"]],
  ["reordered", ["criterion-b", "criterion-a"]],
  ["extra", ["criterion-a", "criterion-b", "criterion-extra"]],
] as const) {
  test(`decision rejects ${name} criterion coverage before confirmation`, async (t) => {
    const { ports, snapshot, submission } = await fixture(t);
    const confirmation = new ScriptedConfirmationPort(true);

    const result = await recordDecision({
      ...decisionRequest(snapshot, submission),
      criteria_reviewed: [...criteriaReviewed],
    }, { ...ports, confirmation });

    assert.equal(result.command, "decision.accept");
    assert.equal(result.code, "CASE_E_TRANSITION");
    assert.equal(confirmation.decisionConfirmations.length, 0);
  });
}

test("decision refuses a non-TTY confirmation source", async (t) => {
  const { root, ports, snapshot, submission } = await fixture(t);
  const confirmation = new ScriptedConfirmationPort(false);

  const result = await recordDecision(decisionRequest(snapshot, submission), { ...ports, confirmation });

  assert.equal(result.command, "decision.accept");
  assert.equal(result.code, "CASE_E_HUMAN_CONFIRMATION");
  assert.equal(confirmation.decisionConfirmations.length, 0);
  assert.deepEqual(await readdir(join(root, ".case-agent", "dossiers", "dossier-a", "decisions")), []);
});

test("decision refuses a wrong or declined confirmation phrase", async (t) => {
  const { root, ports, snapshot, submission } = await fixture(t);
  const confirmation = new ScriptedConfirmationPort(true, [false]);

  const result = await recordDecision(decisionRequest(snapshot, submission), { ...ports, confirmation });

  assert.equal(result.command, "decision.accept");
  assert.equal(result.code, "CASE_E_HUMAN_CONFIRMATION");
  assert.equal(confirmation.decisionConfirmations.length, 1);
  assert.equal(confirmation.decisionConfirmations[0]?.phrase, DECISION_CONFIRMATION_PHRASE);
  assert.deepEqual(await readdir(join(root, ".case-agent", "dossiers", "dossier-a", "decisions")), []);
});

test("an accepted decision records the exact review and keeps the submission current", async (t) => {
  const { root, ports, snapshot, submission } = await fixture(t);
  const confirmation = new ScriptedConfirmationPort(true);
  const request = decisionRequest(snapshot, submission);

  const result = await recordDecision(request, { ...ports, confirmation });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.command, "decision.accept");
  const expected: DecisionEnvelope = {
    decision_id: "decision-op-decide",
    dossier_id: "dossier-a",
    submission_id: submission.submission_id,
    submission_digest: submission.submission_digest,
    decision: "accepted",
    reviewer_id: "reviewer-a",
    criteria_reviewed: ["criterion-a", "criterion-b"],
    comment: "Reviewed exact submission",
    decided_at: timestamp,
    created_operation_id: "op-decide",
    identity_assurance: "recorded-interactive-claim",
  };
  assert.deepEqual(result.data, expected);
  assert.deepEqual(
    JSON.parse(await readFile(join(root, ".case-agent", "dossiers", "dossier-a", "decisions", "decision-op-decide.json"), "utf8")),
    expected,
  );
  assert.equal(confirmation.decisionConfirmations.length, 1);
  assert.deepEqual(confirmation.decisionConfirmations[0]?.review.submission, submission);
  assert.deepEqual(
    confirmation.decisionConfirmations[0]?.review.acceptance_criteria.map(({ criterion_id }) => criterion_id),
    ["criterion-a", "criterion-b"],
  );
  assert.deepEqual(confirmation.decisionConfirmations[0]?.review.decision_envelope, expected);
  assert.equal(confirmation.decisionConfirmations[0]?.review.identity_limitation, RECORDED_IDENTITY_LIMITATION);
  assert.equal(confirmation.decisionConfirmations[0]?.phrase, DECISION_CONFIRMATION_PHRASE);
  const published = await ports.store.loadDossier("dossier-a");
  assert.equal(published.current_submission_id, submission.submission_id);
  assert.equal(published.current_decision_id, expected.decision_id);
  const shown = await showDossier({ dossier_id: "dossier-a" }, ports);
  assert.equal(shown.ok, true);
  assert.equal(shown.ok && shown.data.review, "ready_for_review");
  assert.equal(shown.ok && shown.data.acceptance, "accepted");
});

test("a rejection is recorded against the same exact submission", async (t) => {
  const { ports, snapshot, submission } = await fixture(t);
  const confirmation = new ScriptedConfirmationPort(true);

  const result = await recordDecision({
    ...decisionRequest(snapshot, submission, "op-reject"),
    decision: "rejected",
    comment: "Changes requested",
  }, { ...ports, confirmation });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.decision, "rejected");
  assert.equal(result.data.submission_digest, submission.submission_digest);
  const shown = await showDossier({ dossier_id: "dossier-a" }, ports);
  assert.equal(shown.ok, true);
  assert.equal(shown.ok && shown.data.review, "changes_requested");
  assert.equal(shown.ok && shown.data.acceptance, "rejected");
});

test("orphan decision recovery requires a fresh interactive confirmation", async (t) => {
  const { root, ports, snapshot, submission } = await fixture(t);
  const request = decisionRequest(snapshot, submission, "op-orphan");
  const firstConfirmation = new ScriptedConfirmationPort(true);
  const interrupted = await recordDecision(request, {
    ...ports,
    fs: controlledAtomicFs(root, "after_envelope_create"),
    confirmation: firstConfirmation,
  });
  assert.equal(interrupted.code, "CASE_E_INTERNAL");
  assert.equal(firstConfirmation.decisionConfirmations.length, 1);
  const envelopePath = join(root, ".case-agent", "dossiers", "dossier-a", "decisions", "decision-op-orphan.json");
  const orphan = await readFile(envelopePath);
  assert.equal((await ports.store.loadDossier("dossier-a")).current_decision_id, null);

  const nonInteractive = new ScriptedConfirmationPort(false);
  const refused = await recordDecision(request, { ...ports, confirmation: nonInteractive });
  assert.equal(refused.code, "CASE_E_HUMAN_CONFIRMATION");
  assert.equal(nonInteractive.decisionConfirmations.length, 0);
  assert.deepEqual(await readFile(envelopePath), orphan);
  assert.equal((await ports.store.loadDossier("dossier-a")).current_decision_id, null);

  const retryConfirmation = new ScriptedConfirmationPort(true);
  const recovered = await recordDecision(request, { ...ports, confirmation: retryConfirmation });

  assert.equal(recovered.ok, true);
  if (!recovered.ok) return;
  assert.equal(retryConfirmation.decisionConfirmations.length, 1);
  assert.deepEqual(retryConfirmation.decisionConfirmations[0]?.review.decision_envelope, recovered.data);
  assert.deepEqual(await readFile(envelopePath), orphan);
  assert.equal((await ports.store.loadDossier("dossier-a")).current_decision_id, recovered.data.decision_id);
});

test("accepted work becomes stale after covered artifact bytes change", async (t) => {
  const { ports, snapshot, submission, artifactPath } = await fixture(t);
  const accepted = await recordDecision(decisionRequest(snapshot, submission), {
    ...ports,
    confirmation: new ScriptedConfirmationPort(true),
  });
  assert.equal(accepted.ok, true);

  await writeFile(artifactPath, "changed");
  const shown = await showDossier({ dossier_id: "dossier-a" }, ports);

  assert.equal(shown.ok, true);
  assert.equal(shown.ok && shown.data.acceptance, "stale");
  assert.equal(shown.ok && shown.data.review, "working");
});

test("a new submission clears the old decision pointer", async (t) => {
  const { ports, snapshot, submission } = await fixture(t);
  const accepted = await recordDecision(decisionRequest(snapshot, submission), {
    ...ports,
    confirmation: new ScriptedConfirmationPort(true),
  });
  assert.equal(accepted.ok, true);
  const decided = await ports.store.loadDossier("dossier-a");

  const nextSubmission = await createSubmission({
    dossier_id: "dossier-a",
    expected_revision: decided.state_revision,
    expected_state_digest: decided.state_digest,
    operation_id: "op-submit-next",
    submitting_run_id: "run-a",
  }, ports);

  assert.equal(nextSubmission.ok, true);
  const published = await ports.store.loadDossier("dossier-a");
  assert.equal(published.current_submission_id, nextSubmission.ok ? nextSubmission.data.submission_id : null);
  assert.equal(published.current_decision_id, null);
});

test("a throwing confirmation adapter is internal and releases the guard", async (t) => {
  const { root, ports, snapshot, submission } = await fixture(t);
  const confirmation = new ScriptedConfirmationPort(true, [new Error("terminal failed")]);

  const result = await recordDecision(decisionRequest(snapshot, submission), { ...ports, confirmation });

  assert.equal(result.command, "decision.accept");
  assert.equal(result.code, "CASE_E_INTERNAL");
  assert.equal((await ports.store.loadDossier("dossier-a")).current_decision_id, null);
  await assert.rejects(readFile(join(root, ".case-agent", "locks", "dossier-a.lock")), { code: "ENOENT" });
});

test("an invalid decision timestamp produced by an adapter is internal", async (t) => {
  const { root, ports, snapshot, submission } = await fixture(t);
  let clockReads = 0;
  const decisionPorts: DecisionPorts = {
    ...ports,
    clock: {
      now: () => ++clockReads === 1 ? timestamp : "invalid-timestamp",
      isPossiblyStale: () => false,
    },
    confirmation: new ScriptedConfirmationPort(true),
  };

  const result = await recordDecision(decisionRequest(snapshot, submission), decisionPorts);

  assert.equal(result.command, "decision.accept");
  assert.equal(result.code, "CASE_E_INTERNAL");
  assert.deepEqual(await readdir(join(root, ".case-agent", "dossiers", "dossier-a", "decisions")), []);
  await assert.rejects(readFile(join(root, ".case-agent", "locks", "dossier-a.lock")), { code: "ENOENT" });
});

test("decision classifies a re-digested foreign criterion link as an invariant before currentness", async (t) => {
  const { root, ports, snapshot, submission } = await fixture(t);
  const evidence = snapshot.evidence[0];
  assert.notEqual(evidence, undefined);
  if (evidence === undefined) return;
  const candidate = {
    ...snapshot,
    evidence: [
      { ...evidence, criterion_ids: ["criterion-foreign"] },
      ...snapshot.evidence.slice(1),
    ],
  };
  const injected = { ...candidate, state_digest: digestProjection(projectState(candidate)) };
  const dossierPath = join(root, ".case-agent", "dossiers", "dossier-a", "dossier.json");
  const injectedBytes = Buffer.from(`${JSON.stringify(injected)}\n`);
  await writeFile(dossierPath, injectedBytes);
  const confirmation = new ScriptedConfirmationPort(true);

  const result = await recordDecision(decisionRequest(injected, submission, "op-invalid-link"), {
    ...ports,
    confirmation,
  });

  assert.equal(result.command, "decision.accept");
  assert.equal(result.code, "CASE_E_INVARIANT");
  assert.equal(confirmation.decisionConfirmations.length, 0);
  assert.deepEqual(await readFile(dossierPath), injectedBytes);
  assert.equal((await ports.store.loadDossier("dossier-a")).current_decision_id, null);
  await assert.rejects(readFile(join(root, ".case-agent", "locks", "dossier-a.lock")), { code: "ENOENT" });
});

test("decision reports a structural invariant before a non-current submission conflict", async (t) => {
  const { root, ports, snapshot, submission } = await fixture(t);
  const evidence = snapshot.evidence[0];
  assert.notEqual(evidence, undefined);
  if (evidence === undefined) return;
  const candidate = {
    ...snapshot,
    evidence: [
      { ...evidence, criterion_ids: ["criterion-foreign"] },
      ...snapshot.evidence.slice(1),
    ],
  };
  const injected = { ...candidate, state_digest: digestProjection(projectState(candidate)) };
  const dossierPath = join(root, ".case-agent", "dossiers", "dossier-a", "dossier.json");
  const injectedBytes = Buffer.from(`${JSON.stringify(injected)}\n`);
  await writeFile(dossierPath, injectedBytes);
  const confirmation = new ScriptedConfirmationPort(true);
  const request = {
    ...decisionRequest(injected, submission, "op-invalid-link-old-submission"),
    submission_id: "submission-older",
  };

  const result = await recordDecision(request, { ...ports, confirmation });

  assert.equal(result.command, "decision.accept");
  assert.equal(result.code, "CASE_E_INVARIANT");
  assert.equal(confirmation.decisionConfirmations.length, 0);
  assert.deepEqual(await readFile(dossierPath), injectedBytes);
  assert.equal((await ports.store.loadDossier("dossier-a")).current_decision_id, null);
  await assert.rejects(readFile(join(root, ".case-agent", "locks", "dossier-a.lock")), { code: "ENOENT" });
});
