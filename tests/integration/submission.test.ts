import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { digestProjection } from "../../src/protocol/canonical.js";
import type { JsonValue } from "../../src/protocol/json.js";
import { projectChecks, projectContent, projectObservedEvidence, projectState } from "../../src/protocol/projections.js";
import { SchemaRegistry } from "../../src/protocol/schema-registry.js";
import { revision, type DossierSnapshot, type MutationPrecondition, type SubmissionEnvelope } from "../../src/protocol/types.js";
import { controlledAtomicFs } from "../helpers/fault-port.js";
import { nodePathInspection } from "../../src/storage/paths.js";
import { CaseStore } from "../../src/storage/store.js";
import {
  createDossier,
  type DossierDirectoryPublicationPort,
  type WorkflowPorts,
} from "../../src/workflows/dossier.js";
import { addEvidence, checkDossier, checkSnapshot } from "../../src/workflows/evidence.js";
import { offerHandoff } from "../../src/workflows/handoff.js";
import { createSubmission, type CreateSubmissionRequest } from "../../src/workflows/submission.js";

const timestamp = "2026-09-04T03:02:01Z";

async function fixture(t: TestContext): Promise<{
  root: string;
  ports: WorkflowPorts;
  snapshot: DossierSnapshot;
  artifactPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "case-agent-submission-"));
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
    title: "Submit exact work",
    objective: "Bind review to current evidence bytes",
    scope: { in: ["artifact"], out: [] },
    constraints: ["local-only"],
    acceptance_criteria: [{
      criterion_id: "criterion-a",
      statement: "Artifact remains exact",
      verification: "mechanical",
    }],
  }, ports);
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("fixture dossier creation failed");
  const artifactPath = join(root, "artifacts", "result.txt");
  await mkdir(dirname(artifactPath));
  await writeFile(artifactPath, "current");
  const added = await addEvidence({
    dossier_id: created.data.snapshot.dossier_id,
    expected_revision: created.data.snapshot.state_revision,
    expected_state_digest: created.data.snapshot.state_digest,
    operation_id: "op-add",
    run_id: created.data.snapshot.active_run.run_id,
    criterion_ids: ["criterion-a"],
    kind: "file",
    location: { repository_relative_path: "artifacts/result.txt" },
    freshness: "recompute_on_check",
    limitations: [],
  }, ports);
  assert.equal(added.ok, true);
  if (!added.ok) throw new Error("fixture evidence registration failed");
  return { root, ports, snapshot: added.data.snapshot, artifactPath };
}

function submissionRequest(
  snapshot: DossierSnapshot,
  operationId = "op-submit",
): CreateSubmissionRequest & MutationPrecondition {
  return {
    dossier_id: snapshot.dossier_id,
    expected_revision: snapshot.state_revision,
    expected_state_digest: snapshot.state_digest,
    operation_id: operationId,
    submitting_run_id: snapshot.active_run.run_id,
  };
}

test("submission reruns checks under the writer guard", async (t) => {
  const { root, ports, snapshot, artifactPath } = await fixture(t);
  const displayed = await checkDossier({ dossier_id: snapshot.dossier_id }, ports);
  assert.equal(displayed.ok, true);
  assert.equal(displayed.ok && displayed.data.verdict, "passed");
  await writeFile(artifactPath, "changed");
  const result = await createSubmission(submissionRequest(snapshot), ports);

  assert.equal(result.command, "submission.create");
  assert.equal(result.code, "CASE_E_EVIDENCE");
  assert.deepEqual(await readdir(join(root, ".case-agent", "dossiers", "dossier-a", "submissions")), []);
});

test("only the active run can create a submission", async (t) => {
  const { ports, snapshot } = await fixture(t);

  const result = await createSubmission({
    ...submissionRequest(snapshot),
    submitting_run_id: "run-inactive",
  }, ports);

  assert.equal(result.command, "submission.create");
  assert.equal(result.code, "CASE_E_ACTOR");
  assert.equal((await ports.store.loadDossier(snapshot.dossier_id)).current_submission_id, null);
});

test("submission refuses a still-unaccepted current handoff", async (t) => {
  const { ports, snapshot } = await fixture(t);
  const offered = await offerHandoff({
    dossier_id: snapshot.dossier_id,
    expected_revision: snapshot.state_revision,
    expected_state_digest: snapshot.state_digest,
    operation_id: "op-offer",
    from_run_id: snapshot.active_run.run_id,
    to_actor_id: "actor-b",
  }, ports);
  assert.equal(offered.ok, true);
  if (!offered.ok) return;
  const basis = await ports.store.loadDossier(snapshot.dossier_id);

  const result = await createSubmission(submissionRequest(basis), ports);

  assert.equal(result.command, "submission.create");
  assert.equal(result.code, "CASE_E_TRANSITION");
  assert.equal((await ports.store.loadDossier(snapshot.dossier_id)).current_submission_id, null);
});

test("submission publishes the exact immutable envelope before its pointer", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  const current = await checkSnapshot(snapshot, ports);
  const request = submissionRequest(snapshot);
  const expectedWithoutDigest = {
    submission_id: "submission-op-submit",
    dossier_id: "dossier-a",
    submitting_run_id: "run-a",
    basis_revision: snapshot.state_revision,
    basis_state_digest: snapshot.state_digest,
    published_revision: revision("2"),
    content_digest: digestProjection(projectContent(snapshot)),
    observed_evidence_digest: digestProjection(projectObservedEvidence(current.observed)),
    checks_digest: digestProjection(projectChecks(current.checks)),
    created_at: timestamp,
    created_operation_id: "op-submit",
  } satisfies Omit<SubmissionEnvelope, "submission_digest">;
  const expected: SubmissionEnvelope = {
    ...expectedWithoutDigest,
    submission_digest: digestProjection(expectedWithoutDigest as unknown as JsonValue),
  };

  const result = await createSubmission(request, ports);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.command, "submission.create");
  assert.deepEqual(result.data, expected);
  const envelopePath = join(root, ".case-agent", "dossiers", "dossier-a", "submissions", "submission-op-submit.json");
  assert.deepEqual(JSON.parse(await readFile(envelopePath, "utf8")), expected);
  const published = await ports.store.loadDossier("dossier-a");
  assert.equal(published.current_submission_id, expected.submission_id);
  assert.equal(published.current_decision_id, null);
  assert.equal(published.state_revision, expected.published_revision);
  assert.equal(published.last_operation?.input_digest, digestProjection({ submitting_run_id: "run-a" }));
});

test("an identical submission retry reuses the immutable envelope", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  const request = submissionRequest(snapshot);
  const submitted = await createSubmission(request, ports);
  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;
  const envelopePath = join(root, ".case-agent", "dossiers", "dossier-a", "submissions", submitted.data.submission_id + ".json");
  const before = await readFile(envelopePath);

  const retried = await createSubmission(request, ports);

  assert.equal(retried.ok, true);
  if (!retried.ok) return;
  assert.deepEqual(retried.data, submitted.data);
  assert.deepEqual(await readFile(envelopePath), before);
  assert.equal((await ports.store.loadDossier("dossier-a")).state_revision, "2");
});

test("an orphan submission envelope is reused to complete publication", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  const request = submissionRequest(snapshot, "op-orphan");
  const interrupted = await createSubmission(request, {
    ...ports,
    fs: controlledAtomicFs(root, "after_envelope_create"),
  });
  assert.equal(interrupted.code, "CASE_E_INTERNAL");
  assert.equal((await ports.store.loadDossier("dossier-a")).current_submission_id, null);
  const envelopePath = join(root, ".case-agent", "dossiers", "dossier-a", "submissions", "submission-op-orphan.json");
  const orphan = await readFile(envelopePath);

  const recovered = await createSubmission(request, ports);

  assert.equal(recovered.ok, true);
  if (!recovered.ok) return;
  assert.deepEqual(await readFile(envelopePath), orphan);
  assert.equal(recovered.data.created_at, timestamp);
  assert.equal((await ports.store.loadDossier("dossier-a")).current_submission_id, recovered.data.submission_id);
});

test("submission reports a stale basis as a workflow conflict", async (t) => {
  const { ports, snapshot } = await fixture(t);
  const advanced = await addEvidence({
    dossier_id: snapshot.dossier_id,
    expected_revision: snapshot.state_revision,
    expected_state_digest: snapshot.state_digest,
    operation_id: "op-advance",
    run_id: snapshot.active_run.run_id,
    criterion_ids: ["criterion-a"],
    kind: "human_observation",
    location: { statement: "Additional review note" },
    freshness: "human_review",
    limitations: [],
  }, ports);
  assert.equal(advanced.ok, true);

  const result = await createSubmission(submissionRequest(snapshot, "op-stale"), ports);

  assert.equal(result.command, "submission.create");
  assert.equal(result.code, "CASE_E_CONFLICT");
});

test("submission rejects malformed persisted state without publishing", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  const dossierPath = join(root, ".case-agent", "dossiers", "dossier-a", "dossier.json");
  const malformed = { ...snapshot, title: "tampered without state digest" };
  await writeFile(dossierPath, `${JSON.stringify(malformed)}\n`);

  const result = await createSubmission(submissionRequest(snapshot, "op-malformed"), ports);

  assert.equal(result.command, "submission.create");
  assert.equal(result.code, "CASE_E_INVARIANT");
  assert.deepEqual(await readdir(join(root, ".case-agent", "dossiers", "dossier-a", "submissions")), []);
  assert.deepEqual(JSON.parse(await readFile(dossierPath, "utf8")), malformed);
});

test("submission distinguishes a cross-file envelope mismatch from failed evidence", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  const candidate = { ...snapshot, current_submission_id: "submission-corrupt" };
  const injected = { ...candidate, state_digest: digestProjection(projectState(candidate)) };
  await writeFile(
    join(root, ".case-agent", "dossiers", "dossier-a", "dossier.json"),
    `${JSON.stringify(injected)}\n`,
  );
  await writeFile(
    join(root, ".case-agent", "dossiers", "dossier-a", "submissions", "submission-corrupt.json"),
    "{}\n",
  );

  const result = await createSubmission(submissionRequest(injected, "op-after-corruption"), ports);

  assert.equal(result.command, "submission.create");
  assert.equal(result.code, "CASE_E_INVARIANT");
  assert.deepEqual(
    (await readdir(join(root, ".case-agent", "dossiers", "dossier-a", "submissions"))).sort(),
    ["submission-corrupt.json"],
  );
});
