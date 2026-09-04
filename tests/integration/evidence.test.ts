import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { digestProjection } from "../../src/protocol/canonical.js";
import { projectState } from "../../src/protocol/projections.js";
import { SchemaRegistry } from "../../src/protocol/schema-registry.js";
import { revision, type DossierSnapshot } from "../../src/protocol/types.js";
import { controlledAtomicFs } from "../helpers/fault-port.js";
import { nodePathInspection, type PathInfo, type PathInspectionPort } from "../../src/storage/paths.js";
import { CaseStore } from "../../src/storage/store.js";
import { createDossier, type DossierDirectoryPublicationPort, type WorkflowPorts } from "../../src/workflows/dossier.js";
import { addEvidence, checkDossier, type AddEvidenceRequest } from "../../src/workflows/evidence.js";

const timestamp = "2026-09-04T03:02:01Z";

async function fixture(t: TestContext): Promise<{ root: string; ports: WorkflowPorts; snapshot: DossierSnapshot }> {
  const root = await mkdtemp(join(tmpdir(), "case-agent-evidence-"));
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
      createGuardId: () => "guard-a",
      tempIdFor: () => "temp-a",
      envelopeIdFor: (kind, operationId) => `${kind}-${operationId}`,
      createDossierId: () => "dossier-a",
      createRunId: () => "run-a",
      evidenceIdFor: (operationId) => `evidence-${operationId}`,
    },
  };
  const created = await createDossier({
    operation_id: "op-create",
    actor_id: "actor-a",
    title: "Evidence",
    objective: "Prove artifact bytes",
    scope: { in: ["artifact"], out: [] },
    constraints: [],
    acceptance_criteria: [{ criterion_id: "criterion-a", statement: "Artifact is current", verification: "mechanical" }],
  }, ports);
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("fixture creation failed");
  return { root, ports, snapshot: created.data.snapshot };
}

function fileRequest(snapshot: DossierSnapshot, path = "artifacts/result.txt"): AddEvidenceRequest {
  return {
    dossier_id: snapshot.dossier_id,
    expected_revision: snapshot.state_revision,
    expected_state_digest: snapshot.state_digest,
    operation_id: "op-add",
    run_id: "run-a",
    criterion_ids: ["criterion-a"],
    kind: "file",
    location: { repository_relative_path: path },
    freshness: "recompute_on_check",
    limitations: [],
  };
}

async function writeSnapshot(root: string, snapshot: DossierSnapshot): Promise<DossierSnapshot> {
  const fixed = { ...snapshot, state_digest: digestProjection(projectState(snapshot)) };
  await writeFile(join(root, ".case-agent", "dossiers", snapshot.dossier_id, "dossier.json"), `${JSON.stringify(fixed)}\n`);
  return fixed;
}

test("add evidence hashes and counts the one safely opened local artifact", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  await mkdir(join(root, "artifacts"));
  await writeFile(join(root, "artifacts", "result.txt"), "abc");
  let opens = 0;
  const oneOpenPorts: WorkflowPorts = {
    ...ports,
    evidenceFs: {
      ...nodePathInspection,
      async openRead(path) {
        opens += 1;
        if (opens > 1) throw new Error("artifact opened more than once");
        return nodePathInspection.openRead(path);
      },
    },
  };

  const result = await addEvidence(fileRequest(snapshot), oneOpenPorts);

  assert.equal(result.ok, true);
  assert.equal(opens, 1);
  if (!result.ok) return;
  assert.equal(result.data.evidence.artifact_size, "3");
  assert.equal(result.data.evidence.artifact_digest, "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(result.data.snapshot.state_revision, "1");
  assert.equal(result.data.snapshot.last_operation?.operation_id, "op-add");
  const checked = await checkDossier({ dossier_id: snapshot.dossier_id }, ports);
  assert.equal(checked.ok, true);
  assert.equal(checked.ok && checked.data.verdict, "passed");
});

test("an identical immediate add retry returns the committed evidence without reopening the artifact", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  await mkdir(join(root, "artifacts"));
  await writeFile(join(root, "artifacts", "result.txt"), "abc");
  const request = fileRequest(snapshot);
  assert.equal((await addEvidence(request, ports)).ok, true);
  await unlink(join(root, "artifacts", "result.txt"));
  const noOpenPorts: WorkflowPorts = {
    ...ports,
    evidenceFs: { ...nodePathInspection, openRead: async () => { throw new Error("retry reopened artifact"); } },
  };

  const retried = await addEvidence(request, noOpenPorts);

  assert.equal(retried.ok, true);
  if (!retried.ok) return;
  assert.equal(retried.data.evidence.evidence_id, "evidence-op-add");
  assert.equal(retried.data.snapshot.state_revision, "1");
});

test("add evidence retains existing submission and decision pointers", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  await mkdir(join(root, "artifacts"));
  await writeFile(join(root, "artifacts", "result.txt"), "abc");
  const withPointers = await writeSnapshot(root, {
    ...snapshot,
    current_submission_id: "submission-current",
    current_decision_id: "decision-current",
  });

  const result = await addEvidence(fileRequest(withPointers), ports);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.snapshot.current_submission_id, "submission-current");
  assert.equal(result.data.snapshot.current_decision_id, "decision-current");
});

test("add evidence rejects an unknown criterion before opening the artifact", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  await mkdir(join(root, "artifacts"));
  await writeFile(join(root, "artifacts", "result.txt"), "abc");
  let opens = 0;
  const unopenedPorts: WorkflowPorts = {
    ...ports,
    evidenceFs: { ...nodePathInspection, openRead: async (path) => { opens += 1; return nodePathInspection.openRead(path); } },
  };

  const result = await addEvidence({ ...fileRequest(snapshot), criterion_ids: ["criterion-unknown"] }, unopenedPorts);

  assert.equal(result.code, "CASE_E_USAGE");
  assert.equal(opens, 0);
});

test("add evidence rejects empty local artifacts", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  await mkdir(join(root, "artifacts"));
  await writeFile(join(root, "artifacts", "result.txt"), "");

  const result = await addEvidence(fileRequest(snapshot), ports);

  assert.equal(result.code, "CASE_E_EVIDENCE");
});

test("recorded human evidence remains review data and does not access a local artifact", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  const humanSnapshot = await writeSnapshot(root, {
    ...snapshot,
    acceptance_criteria: [{
      criterion_id: "criterion-a",
      statement: "A reviewer inspects the result",
      verification: "recorded_human_review",
    }],
  });
  const noArtifactPorts: WorkflowPorts = {
    ...ports,
    evidenceFs: { ...nodePathInspection, openRead: async () => { throw new Error("human evidence opened a file"); } },
  };

  const added = await addEvidence({
    dossier_id: humanSnapshot.dossier_id,
    expected_revision: humanSnapshot.state_revision,
    expected_state_digest: humanSnapshot.state_digest,
    operation_id: "op-human",
    run_id: "run-a",
    criterion_ids: ["criterion-a"],
    kind: "human_observation",
    location: { statement: "Reviewed on the target display" },
    freshness: "human_review",
    limitations: ["Recorded claim only"],
  }, noArtifactPorts);
  assert.equal(added.ok, true);

  const checked = await checkDossier({ dossier_id: humanSnapshot.dossier_id }, noArtifactPorts);

  assert.equal(checked.ok, true);
  if (!checked.ok) return;
  assert.equal(checked.data.verdict, "passed");
  assert.equal(checked.data.criterion_results[0]?.status, "human_review_required");
});

test("check is read-only and reports a changed artifact with stable data", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  await mkdir(join(root, "artifacts"));
  await writeFile(join(root, "artifacts", "result.txt"), "abc");
  const added = await addEvidence(fileRequest(snapshot), ports);
  assert.equal(added.ok, true);
  await writeFile(join(root, "artifacts", "result.txt"), "changed");
  const before = await readFile(join(root, ".case-agent", "dossiers", "dossier-a", "dossier.json"));

  const result = await checkDossier({ dossier_id: "dossier-a" }, ports);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.verdict, "failed");
  assert.equal(result.data.criterion_results[0]?.status, "failed");
  assert.equal(result.data.invariant_results.find(({ code }) => code === "CASE_I_EVIDENCE_INTEGRITY")?.status, "failed");
  assert.deepEqual(await readFile(join(root, ".case-agent", "dossiers", "dossier-a", "dossier.json")), before);
});

test("check fails the observation closed when the opened handle cannot be closed", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  await mkdir(join(root, "artifacts"));
  await writeFile(join(root, "artifacts", "result.txt"), "abc");
  const added = await addEvidence(fileRequest(snapshot), ports);
  assert.equal(added.ok, true);
  const closeFailingPorts: WorkflowPorts = {
    ...ports,
    evidenceFs: {
      ...nodePathInspection,
      async openRead(path) {
        const opened = await nodePathInspection.openRead(path);
        return { ...opened, close: async () => { await opened.close(); throw new Error("close failed"); } };
      },
    },
  };

  const result = await checkDossier({ dossier_id: "dossier-a" }, closeFailingPorts);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.verdict, "failed");
  assert.equal(result.data.stable_warning_codes.includes("CASE_L_EVIDENCE_UNSAFE"), true);
});

for (const [name, path, prepare, expected] of [
  ["missing", "artifacts/result.txt", async (root: string) => { await mkdir(join(root, "artifacts")); }, "CASE_L_EVIDENCE_MISSING"],
  ["outside-root", "../outside.txt", async () => {}, "CASE_L_EVIDENCE_UNSAFE"],
] as const) {
  test(`check derives stable ${name} evidence without leaking a path`, async (t) => {
    const { root, ports, snapshot } = await fixture(t);
    await prepare(root);
    const declared = {
      evidence_id: "evidence-op-add",
      criterion_ids: ["criterion-a"],
      captured_at: timestamp,
      freshness: "recompute_on_check" as const,
      limitations: [],
      kind: "file" as const,
      location: { repository_relative_path: path },
      artifact_digest: digestProjection({ declared: "bytes" }),
      artifact_size: "3" as never,
    };
    await writeSnapshot(root, { ...snapshot, evidence: [declared] });

    const result = await checkDossier({ dossier_id: "dossier-a" }, ports);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.verdict, "failed");
    assert.equal(JSON.stringify(result).includes(root), false);
    assert.equal(result.data.stable_warning_codes.includes(expected), true);
  });
}

test("check classifies an empty artifact distinctly", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  await mkdir(join(root, "artifacts"));
  await writeFile(join(root, "artifacts", "result.txt"), "");
  await writeSnapshot(root, {
    ...snapshot,
    evidence: [{
      evidence_id: "evidence-empty",
      criterion_ids: ["criterion-a"],
      captured_at: timestamp,
      freshness: "recompute_on_check",
      limitations: [],
      kind: "file",
      location: { repository_relative_path: "artifacts/result.txt" },
      artifact_digest: digestProjection({ declared: "non-empty" }),
      artifact_size: "3" as never,
    }],
  });

  const result = await checkDossier({ dossier_id: "dossier-a" }, ports);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.stable_warning_codes.includes("CASE_L_EVIDENCE_EMPTY"), true);
});

test("check rejects injected linked local evidence without opening through it", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  await writeSnapshot(root, {
    ...snapshot,
    evidence: [{
      evidence_id: "evidence-link",
      criterion_ids: ["criterion-a"],
      captured_at: timestamp,
      freshness: "recompute_on_check",
      limitations: [],
      kind: "file",
      location: { repository_relative_path: "artifacts/linked.txt" },
      artifact_digest: digestProjection({ declared: "bytes" }),
      artifact_size: "3" as never,
    }],
  });
  const directory = (device: bigint, inode: bigint): PathInfo => ({
    device,
    inode,
    isDirectory: () => true,
    isFile: () => false,
    isSymbolicLink: () => false,
    isReparsePoint: () => false,
  });
  const link: PathInfo = {
    device: 1n,
    inode: 3n,
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => true,
    isReparsePoint: () => true,
  };
  let opens = 0;
  const injectedLinkFs: PathInspectionPort = {
    lstat: async (path) => path === root
      ? directory(1n, 1n)
      : path === join(root, "artifacts")
        ? directory(1n, 2n)
        : link,
    realpath: async (path) => path,
    listDirectory: async (path) => path === root
      ? [{ name: "artifacts" }]
      : [{ name: "linked.txt" }],
    openRead: async () => { opens += 1; throw new Error("link must not be opened"); },
  };

  const result = await checkDossier({ dossier_id: "dossier-a" }, { ...ports, evidenceFs: injectedLinkFs });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.verdict, "failed");
  assert.equal(result.data.stable_warning_codes.includes("CASE_L_EVIDENCE_UNSAFE"), true);
  assert.equal(opens, 0);
});
