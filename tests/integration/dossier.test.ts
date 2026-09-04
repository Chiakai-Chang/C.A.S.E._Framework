import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { digestProjection } from "../../src/protocol/canonical.js";
import { projectChecks, projectState, projectSubmission } from "../../src/protocol/projections.js";
import { SchemaRegistry } from "../../src/protocol/schema-registry.js";
import { revision, type DecisionEnvelope, type DossierSnapshot, type SubmissionEnvelope } from "../../src/protocol/types.js";
import { CaseStore } from "../../src/storage/store.js";
import { nodePathInspection } from "../../src/storage/paths.js";
import { controlledAtomicFs } from "../helpers/fault-port.js";
import {
  createDossier,
  showDossier,
  type CreateDossierRequest,
  type DossierDirectoryPublicationPort,
  type WorkflowPorts,
} from "../../src/workflows/dossier.js";
import { addEvidence, checkDossier } from "../../src/workflows/evidence.js";

const now = "2026-09-04T03:02:01Z";

async function fixture(t: TestContext): Promise<{ root: string; ports: WorkflowPorts; publications: { count: number } }> {
  const root = await mkdtemp(join(tmpdir(), "case-agent-dossier-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".case-agent", "dossiers"), { recursive: true });
  await mkdir(join(root, ".case-agent", "locks"), { recursive: true });
  const schemas = await SchemaRegistry.load(join(process.cwd(), "schemas"));
  const publications = { count: 0 };
  const dossiers: DossierDirectoryPublicationPort = {
    profile: {
      supported: true,
      profile: "test-create-once-directory",
      crash_safety: "process-crash",
      physical_durability: false,
    },
    async publishCreateOnce(relativeDirectory, contents) {
      publications.count += 1;
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
  const store = new CaseStore(root, schemas);
  const ports: WorkflowPorts = {
    repository_root: root,
    store,
    schemas,
    evidenceFs: nodePathInspection,
    fs: controlledAtomicFs(root),
    dossiers,
    processIdentity: {
      current: async () => ({ profile: "test", pid: "1", process_started_at: now }),
      verifyTerminated: async () => "terminated",
    },
    clock: { now: () => now, isPossiblyStale: () => false },
    ids: {
      createGuardId: () => "guard-a",
      tempIdFor: () => "temp-a",
      envelopeIdFor: (kind, operationId) => `${kind}-${operationId}`,
      createDossierId: () => "dossier-a",
      createRunId: () => "run-a",
      evidenceIdFor: (operationId) => `evidence-${operationId}`,
    },
  };
  return { root, ports, publications };
}

const validCreateRequest: CreateDossierRequest = {
  operation_id: "op-create",
  actor_id: "actor-a",
  title: "Protect release integrity",
  objective: "Prove the release artifact is current",
  scope: { in: ["release artifact"], out: ["deployment"] },
  constraints: ["local-only"],
  acceptance_criteria: [
    { criterion_id: "criterion-a", statement: "Artifact digest matches", verification: "mechanical" },
  ],
};

test("create fixes the brief and initial active run in one complete directory", async (t) => {
  const { root, ports, publications } = await fixture(t);

  const result = await createDossier(validCreateRequest, ports);

  assert.equal(result.ok, true);
  assert.equal(publications.count, 1);
  if (!result.ok) return;
  assert.equal(result.data.snapshot.state_revision, "0");
  assert.deepEqual(result.data.snapshot.active_run, {
    run_id: "run-a",
    actor_id: "actor-a",
    started_by_handoff_id: null,
  });
  assert.equal(result.data.snapshot.last_operation, null);
  assert.equal(result.data.snapshot.state_digest, digestProjection(projectState(result.data.snapshot)));
  assert.deepEqual(
    JSON.parse(await readFile(join(root, ".case-agent", "dossiers", "dossier-a", "dossier.json"), "utf8")),
    result.data.snapshot,
  );
  assert.equal((await readFile(join(root, ".case-agent", "dossiers", "dossier-a", "dossier.json"), "utf8")).endsWith("\n"), true);
  assert.deepEqual((await readdir(join(root, ".case-agent", "dossiers", "dossier-a"))).sort(), [
    "decisions", "dossier.json", "handoffs", "submissions",
  ]);
  assert.deepEqual(await readdir(join(root, ".case-agent", "dossiers", "dossier-a", "handoffs")), []);
});

test("create validates the complete brief before publication", async (t) => {
  const { ports, publications } = await fixture(t);
  const request = {
    ...validCreateRequest,
    acceptance_criteria: [
      ...validCreateRequest.acceptance_criteria,
      { ...validCreateRequest.acceptance_criteria[0]!, statement: "Duplicate criterion" },
    ],
  };

  const result = await createDossier(request, ports);

  assert.equal(result.code, "CASE_E_USAGE");
  assert.equal(publications.count, 0);
});

test("create fails closed when complete-directory publication is unproven", async (t) => {
  const { ports, publications } = await fixture(t);
  const unsupported: WorkflowPorts = {
    ...ports,
    dossiers: {
      profile: { supported: false, profile: "unproven", reason: "unclassified-filesystem" },
      publishCreateOnce: ports.dossiers.publishCreateOnce,
    },
  };

  const result = await createDossier(validCreateRequest, unsupported);

  assert.equal(result.code, "CASE_E_INTERNAL");
  assert.equal(publications.count, 0);
});

test("show never guesses a dossier", async (t) => {
  const { ports } = await fixture(t);

  const result = await showDossier({ dossier_id: "" }, ports);

  assert.equal(result.code, "CASE_E_USAGE");
});

test("show recomputes a bounded current view with the full machine basis and one next action", async (t) => {
  const { ports } = await fixture(t);
  const created = await createDossier(validCreateRequest, ports);
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const result = await showDossier({ dossier_id: created.data.snapshot.dossier_id }, ports);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.objective, validCreateRequest.objective);
  assert.deepEqual(result.data.active_run, created.data.snapshot.active_run);
  assert.equal(result.data.state_revision, "0");
  assert.equal(result.data.state_digest, created.data.snapshot.state_digest);
  assert.equal(result.data.state_digest.length, 71);
  assert.deepEqual(result.data.criterion_results, [{
    criterion_id: "criterion-a",
    status: "failed",
    supporting_evidence_ids: [],
  }]);
  assert.deepEqual(result.data.evidence_gaps, ["criterion-a"]);
  assert.equal(result.data.current_checks, "failed");
  assert.equal(result.data.review, "working");
  assert.equal(result.data.acceptance, "pending");
  assert.equal(result.data.handoff, "none");
  assert.equal(result.data.recommended_next_action, "CASE_NEXT_ADD_EVIDENCE");
  assert.equal(typeof result.data.recommended_next_action, "string");
});

async function replaceSnapshot(root: string, candidate: DossierSnapshot): Promise<DossierSnapshot> {
  const snapshot = { ...candidate, state_digest: digestProjection(projectState(candidate)) };
  await writeFile(join(root, ".case-agent", "dossiers", candidate.dossier_id, "dossier.json"), `${JSON.stringify(snapshot)}\n`);
  return snapshot;
}

test("show derives current acceptance and stales it when covered artifact bytes change", async (t) => {
  const { root, ports } = await fixture(t);
  const created = await createDossier(validCreateRequest, ports);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await mkdir(join(root, "artifacts"));
  await writeFile(join(root, "artifacts", "release.txt"), "current");
  const added = await addEvidence({
    dossier_id: created.data.snapshot.dossier_id,
    expected_revision: created.data.snapshot.state_revision,
    expected_state_digest: created.data.snapshot.state_digest,
    operation_id: "op-add",
    run_id: "run-a",
    criterion_ids: ["criterion-a"],
    kind: "file",
    location: { repository_relative_path: "artifacts/release.txt" },
    freshness: "recompute_on_check",
    limitations: [],
  }, ports);
  assert.equal(added.ok, true);
  if (!added.ok) return;
  const checked = await checkDossier({ dossier_id: "dossier-a" }, ports);
  assert.equal(checked.ok, true);
  if (!checked.ok) return;

  const submissionWithoutDigest = {
    submission_id: "submission-current",
    dossier_id: "dossier-a",
    submitting_run_id: "run-a",
    basis_revision: added.data.snapshot.state_revision,
    basis_state_digest: added.data.snapshot.state_digest,
    published_revision: revision("2"),
    content_digest: checked.data.content_digest,
    observed_evidence_digest: checked.data.observed_evidence_digest,
    checks_digest: digestProjection(projectChecks(checked.data)),
    created_at: now,
    created_operation_id: "op-submit",
  };
  const submission: SubmissionEnvelope = {
    ...submissionWithoutDigest,
    submission_digest: digestProjection(projectSubmission({
      ...submissionWithoutDigest,
      submission_digest: digestProjection({}),
    })),
  };
  await writeFile(join(root, ".case-agent", "dossiers", "dossier-a", "submissions", "submission-current.json"), `${JSON.stringify(submission)}\n`);
  const submitted = await replaceSnapshot(root, {
    ...added.data.snapshot,
    state_revision: revision("2"),
    state_digest: digestProjection({}),
    last_operation: {
      operation_id: "op-submit",
      input_digest: digestProjection({ submit: "current" }),
      basis_revision: revision("1"),
      resulting_revision: revision("2"),
    },
    current_submission_id: submission.submission_id,
  });
  const decision: DecisionEnvelope = {
    decision_id: "decision-current",
    dossier_id: "dossier-a",
    submission_id: submission.submission_id,
    submission_digest: submission.submission_digest,
    decision: "accepted",
    reviewer_id: "reviewer-a",
    criteria_reviewed: ["criterion-a"],
    comment: "Accepted",
    decided_at: now,
    created_operation_id: "op-decide",
    identity_assurance: "recorded-interactive-claim",
  };
  await writeFile(join(root, ".case-agent", "dossiers", "dossier-a", "decisions", "decision-current.json"), `${JSON.stringify(decision)}\n`);
  await replaceSnapshot(root, {
    ...submitted,
    state_revision: revision("3"),
    state_digest: digestProjection({}),
    last_operation: {
      operation_id: "op-decide",
      input_digest: digestProjection({ decision: "accepted" }),
      basis_revision: revision("2"),
      resulting_revision: revision("3"),
    },
    current_decision_id: decision.decision_id,
  });

  const current = await showDossier({ dossier_id: "dossier-a" }, ports);
  assert.equal(current.ok, true);
  if (!current.ok) return;
  assert.equal(current.data.current_checks, "passed");
  assert.equal(current.data.review, "ready_for_review");
  assert.equal(current.data.acceptance, "accepted");
  assert.equal(current.data.recommended_next_action, "CASE_NEXT_NONE");

  await writeFile(join(root, "artifacts", "release.txt"), "changed");
  const stale = await showDossier({ dossier_id: "dossier-a" }, ports);
  assert.equal(stale.ok, true);
  if (!stale.ok) return;
  assert.equal(stale.data.current_checks, "failed");
  assert.equal(stale.data.review, "working");
  assert.equal(stale.data.acceptance, "stale");
  assert.equal(stale.data.recommended_next_action, "CASE_NEXT_ADD_EVIDENCE");
});
