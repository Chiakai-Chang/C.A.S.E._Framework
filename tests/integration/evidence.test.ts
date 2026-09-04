import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { digestProjection } from "../../src/protocol/canonical.js";
import { projectChecks, projectState, projectSubmission } from "../../src/protocol/projections.js";
import { SchemaRegistry } from "../../src/protocol/schema-registry.js";
import {
  digest,
  revision,
  type DecisionEnvelope,
  type DossierSnapshot,
  type HandoffEnvelope,
  type SubmissionEnvelope,
} from "../../src/protocol/types.js";
import { controlledAtomicFs } from "../helpers/fault-port.js";
import { nodePathInspection, type PathInfo, type PathInspectionPort } from "../../src/storage/paths.js";
import { CaseStore } from "../../src/storage/store.js";
import { createDossier, type DossierDirectoryPublicationPort, type WorkflowPorts } from "../../src/workflows/dossier.js";
import { addEvidence, checkDossier, checkSnapshot, type AddEvidenceRequest } from "../../src/workflows/evidence.js";

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

function submissionEnvelope(
  snapshot: DossierSnapshot,
  submissionId: string,
  basisRevision = snapshot.state_revision,
  publishedRevision = revision(String(BigInt(basisRevision) + 1n)),
): SubmissionEnvelope {
  const candidate: SubmissionEnvelope = {
    submission_id: submissionId,
    dossier_id: snapshot.dossier_id,
    submitting_run_id: snapshot.active_run.run_id,
    basis_revision: basisRevision,
    basis_state_digest: snapshot.state_digest,
    published_revision: publishedRevision,
    content_digest: digest(`sha256:${"1".repeat(64)}`),
    observed_evidence_digest: digest(`sha256:${"2".repeat(64)}`),
    checks_digest: digest(`sha256:${"3".repeat(64)}`),
    created_at: timestamp,
    created_operation_id: `op-${submissionId}`,
    submission_digest: digest(`sha256:${"0".repeat(64)}`),
  };
  return { ...candidate, submission_digest: digestProjection(projectSubmission(candidate)) };
}

async function writeEnvelope(root: string, snapshot: DossierSnapshot, kind: "handoffs" | "submissions" | "decisions", id: string, envelope: unknown): Promise<void> {
  await writeFile(
    join(root, ".case-agent", "dossiers", snapshot.dossier_id, kind, `${id}.json`),
    `${JSON.stringify(envelope)}\n`,
    { flag: "wx" },
  );
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
  if (!checked.ok) return;
  assert.equal(Object.hasOwn(checked.data.invariant_results[0]!, "stage"), false);
  assert.deepEqual(ports.schemas.validate("checks", checked.data), { ok: true });
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

test("check reports a recoverable handoff orphan without applying it", async (t) => {
  const { root, ports } = await fixture(t);
  const snapshot = await ports.store.loadDossier("dossier-a");
  const cleanCheck = await checkSnapshot(snapshot, ports);
  const orphan: HandoffEnvelope = {
    handoff_id: "handoff-orphan",
    dossier_id: snapshot.dossier_id,
    from_run_id: snapshot.active_run.run_id,
    to_actor_id: "actor-b",
    basis_revision: snapshot.state_revision,
    basis_state_digest: snapshot.state_digest,
    published_revision: revision(String(BigInt(snapshot.state_revision) + 1n)),
    offered_content_digest: digest(`sha256:${"4".repeat(64)}`),
    created_operation_id: "op-orphan",
  };
  await writeEnvelope(root, snapshot, "handoffs", orphan.handoff_id, orphan);
  const before = await readFile(join(root, ".case-agent", "dossiers", "dossier-a", "dossier.json"));
  const orphanCheck = await checkSnapshot(snapshot, ports);

  assert.equal(orphanCheck.orphanEnvelope, true);
  assert.deepEqual(orphanCheck.checks, cleanCheck.checks);
  assert.equal(
    digestProjection(projectChecks(orphanCheck.checks)),
    digestProjection(projectChecks(cleanCheck.checks)),
  );

  const result = await checkDossier({ dossier_id: "dossier-a" }, ports);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.stable_warning_codes.includes("CASE_L_ORPHAN_ENVELOPE"), true);
  assert.equal((await ports.store.loadDossier("dossier-a")).current_handoff_id, null);
  assert.deepEqual(await readFile(join(root, ".case-agent", "dossiers", "dossier-a", "dossier.json")), before);
});

test("recoverable submission and decision orphans are found after stale history", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  const staleHandoff: HandoffEnvelope = {
    handoff_id: "handoff-history",
    dossier_id: snapshot.dossier_id,
    from_run_id: snapshot.active_run.run_id,
    to_actor_id: "actor-old",
    basis_revision: revision("8"),
    basis_state_digest: digest(`sha256:${"5".repeat(64)}`),
    published_revision: revision("9"),
    offered_content_digest: digest(`sha256:${"6".repeat(64)}`),
    created_operation_id: "op-history",
  };
  await writeEnvelope(root, snapshot, "handoffs", staleHandoff.handoff_id, staleHandoff);
  const orphanSubmission = submissionEnvelope(snapshot, "submission-orphan");
  await writeEnvelope(root, snapshot, "submissions", orphanSubmission.submission_id, orphanSubmission);

  const submissionResult = await checkDossier({ dossier_id: snapshot.dossier_id }, ports);
  assert.equal(submissionResult.ok, true);
  assert.equal(submissionResult.ok && submissionResult.data.stable_warning_codes.includes("CASE_L_ORPHAN_ENVELOPE"), true);

  await rm(join(root, ".case-agent", "dossiers", snapshot.dossier_id, "submissions", `${orphanSubmission.submission_id}.json`));
  const currentSubmission = submissionEnvelope(snapshot, "submission-current", revision("0"), revision("1"));
  await writeEnvelope(root, snapshot, "submissions", currentSubmission.submission_id, currentSubmission);
  const withSubmission = await writeSnapshot(root, {
    ...snapshot,
    state_revision: revision("1"),
    current_submission_id: currentSubmission.submission_id,
  });
  const orphanDecision: DecisionEnvelope = {
    decision_id: "decision-orphan",
    dossier_id: withSubmission.dossier_id,
    submission_id: currentSubmission.submission_id,
    submission_digest: currentSubmission.submission_digest,
    decision: "accepted",
    reviewer_id: "reviewer-a",
    criteria_reviewed: ["criterion-a"],
    comment: "Recoverable decision",
    decided_at: timestamp,
    created_operation_id: "op-decision-orphan",
    identity_assurance: "recorded-interactive-claim",
  };
  await writeEnvelope(root, withSubmission, "decisions", orphanDecision.decision_id, orphanDecision);

  const decisionResult = await checkDossier({ dossier_id: withSubmission.dossier_id }, ports);
  assert.equal(decisionResult.ok, true);
  assert.equal(decisionResult.ok && decisionResult.data.stable_warning_codes.includes("CASE_L_ORPHAN_ENVELOPE"), true);
});

test("superseded envelope history is not reported as a recoverable orphan", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  const staleHandoff: HandoffEnvelope = {
    handoff_id: "handoff-history",
    dossier_id: snapshot.dossier_id,
    from_run_id: snapshot.active_run.run_id,
    to_actor_id: "actor-old",
    basis_revision: revision("8"),
    basis_state_digest: digest(`sha256:${"5".repeat(64)}`),
    published_revision: revision("9"),
    offered_content_digest: digest(`sha256:${"6".repeat(64)}`),
    created_operation_id: "op-history",
  };
  const staleSubmission = submissionEnvelope(snapshot, "submission-history", revision("8"), revision("9"));
  await writeEnvelope(root, snapshot, "handoffs", staleHandoff.handoff_id, staleHandoff);
  await writeEnvelope(root, snapshot, "submissions", staleSubmission.submission_id, staleSubmission);
  const staleDecision: DecisionEnvelope = {
    decision_id: "decision-history",
    dossier_id: snapshot.dossier_id,
    submission_id: staleSubmission.submission_id,
    submission_digest: staleSubmission.submission_digest,
    decision: "rejected",
    reviewer_id: "reviewer-old",
    criteria_reviewed: ["criterion-a"],
    comment: "Superseded review history",
    decided_at: timestamp,
    created_operation_id: "op-decision-history",
    identity_assurance: "recorded-interactive-claim",
  };
  await writeEnvelope(root, snapshot, "decisions", staleDecision.decision_id, staleDecision);

  const result = await checkDossier({ dossier_id: snapshot.dossier_id }, ports);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.data.stable_warning_codes.includes("CASE_L_ORPHAN_ENVELOPE"), false);
});

test("an untrusted handoff listing cannot hide later orphan directories", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  const orphanSubmission = submissionEnvelope(snapshot, "submission-behind-untrusted-handoff");
  await writeEnvelope(root, snapshot, "submissions", orphanSubmission.submission_id, orphanSubmission);
  const listed: string[] = [];
  const untrustedPorts: WorkflowPorts = {
    ...ports,
    evidenceFs: {
      ...nodePathInspection,
      async listDirectory(path) {
        const kind = path.split(/[\\/]/u).at(-1) ?? "";
        if (["handoffs", "submissions", "decisions"].includes(kind)) listed.push(kind);
        if (kind === "handoffs") throw new Error("listing unavailable");
        return nodePathInspection.listDirectory(path);
      },
    },
  };

  const result = await checkDossier({ dossier_id: snapshot.dossier_id }, untrustedPorts);
  assert.equal(result.ok, false);
  assert.equal(result.code, "CASE_E_INVARIANT");
  assert.deepEqual([...new Set(listed)], ["handoffs", "submissions", "decisions"]);
});

test("an untrusted handoff listing cannot hide a later recoverable decision", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  const currentSubmission = submissionEnvelope(snapshot, "submission-current", revision("0"), revision("1"));
  await writeEnvelope(root, snapshot, "submissions", currentSubmission.submission_id, currentSubmission);
  const withSubmission = await writeSnapshot(root, {
    ...snapshot,
    state_revision: revision("1"),
    current_submission_id: currentSubmission.submission_id,
  });
  const orphanDecision: DecisionEnvelope = {
    decision_id: "decision-behind-untrusted-handoff",
    dossier_id: withSubmission.dossier_id,
    submission_id: currentSubmission.submission_id,
    submission_digest: currentSubmission.submission_digest,
    decision: "accepted",
    reviewer_id: "reviewer-a",
    criteria_reviewed: ["criterion-a"],
    comment: "Recoverable decision",
    decided_at: timestamp,
    created_operation_id: "op-decision-behind-untrusted-handoff",
    identity_assurance: "recorded-interactive-claim",
  };
  await writeEnvelope(root, withSubmission, "decisions", orphanDecision.decision_id, orphanDecision);
  let handoffListings = 0;
  let decisionListings = 0;
  const untrustedPorts: WorkflowPorts = {
    ...ports,
    evidenceFs: {
      ...nodePathInspection,
      async listDirectory(path) {
        const kind = path.split(/[\\/]/u).at(-1) ?? "";
        if (kind === "handoffs") {
          handoffListings += 1;
          throw new Error("listing unavailable");
        }
        if (kind === "decisions") decisionListings += 1;
        return nodePathInspection.listDirectory(path);
      },
    },
  };

  const result = await checkDossier({ dossier_id: withSubmission.dossier_id }, untrustedPorts);
  assert.equal(result.ok, false);
  assert.equal(result.code, "CASE_E_INVARIANT");
  assert.equal(handoffListings, 1);
  assert.ok(decisionListings >= 1);
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
    hardLinkCount: 1n,
    isDirectory: () => true,
    isFile: () => false,
    isSymbolicLink: () => false,
    isReparsePoint: () => false,
  });
  const link: PathInfo = {
    device: 1n,
    inode: 3n,
    hardLinkCount: 1n,
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => true,
    isReparsePoint: () => true,
  };
  let opens = 0;
  const artifactsDirectory = join(root, "artifacts");
  const linkedArtifact = join(artifactsDirectory, "linked.txt");
  const injectedLinkFs: PathInspectionPort = {
    lstat: async (path) => path === artifactsDirectory
      ? directory(1n, 2n)
      : path === linkedArtifact
        ? link
        : nodePathInspection.lstat(path),
    realpath: async (path) => path === artifactsDirectory || path === linkedArtifact
      ? path
      : nodePathInspection.realpath(path),
    listDirectory: async (path) => path === root
      ? [...await nodePathInspection.listDirectory(path), { name: "artifacts" }]
      : path === artifactsDirectory
        ? [{ name: "linked.txt" }]
        : nodePathInspection.listDirectory(path),
    openRead: async (path) => {
      if (path === linkedArtifact) {
        opens += 1;
        throw new Error("link must not be opened");
      }
      return nodePathInspection.openRead(path);
    },
  };

  const result = await checkDossier({ dossier_id: "dossier-a" }, { ...ports, evidenceFs: injectedLinkFs });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.verdict, "failed");
  assert.equal(result.data.stable_warning_codes.includes("CASE_L_EVIDENCE_UNSAFE"), true);
  assert.equal(opens, 0);
});
