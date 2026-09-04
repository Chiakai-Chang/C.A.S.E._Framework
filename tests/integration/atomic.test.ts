import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { digestProjection } from "../../src/protocol/canonical.js";
import { projectContent, projectState, projectSubmission } from "../../src/protocol/projections.js";
import { SchemaRegistry } from "../../src/protocol/schema-registry.js";
import {
  digest,
  revision,
  type DecisionEnvelope,
  type Digest,
  type DossierSnapshot,
  type HandoffEnvelope,
  type SubmissionEnvelope,
} from "../../src/protocol/types.js";
import {
  commitEnvelopeMutation,
  commitSnapshotMutation,
  nodeAtomicFsPort,
  type ImmutableEnvelopePlan,
} from "../../src/storage/atomic.js";
import {
  acquireWriterGuard,
  recoverWriterGuard,
  type GovernedMutationPrecondition,
  type MutationPorts,
} from "../../src/storage/guard.js";
import { CaseStore } from "../../src/storage/store.js";
import { controlledAtomicFs, type FaultPoint } from "../helpers/fault-port.js";

const ZERO_DIGEST = digest(`sha256:${"0".repeat(64)}`);

function fixed(snapshot: DossierSnapshot): DossierSnapshot {
  const candidate = { ...snapshot, state_digest: ZERO_DIGEST };
  return { ...candidate, state_digest: digestProjection(projectState(candidate)) };
}

function advance(basis: DossierSnapshot, request: GovernedMutationPrecondition, changes: Partial<DossierSnapshot>): DossierSnapshot {
  const next = revision((BigInt(basis.state_revision) + 1n).toString());
  return fixed({
    ...basis,
    ...changes,
    state_revision: next,
    last_operation: {
      operation_id: request.operation_id,
      input_digest: request.input_digest,
      basis_revision: request.expected_revision,
      resulting_revision: next,
    },
  });
}

async function fixture(t: TestContext, fault?: FaultPoint) {
  const root = await mkdtemp(join(process.cwd(), ".tmp-atomic-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const dossier = join(root, ".case-agent", "dossiers", "dossier-a");
  await mkdir(join(root, ".case-agent", "locks"), { recursive: true });
  for (const child of ["handoffs", "submissions", "decisions"]) await mkdir(join(dossier, child), { recursive: true });
  const schemas = await SchemaRegistry.load(join(process.cwd(), "schemas"));
  const initial = fixed({
    dossier_id: "dossier-a",
    title: "Initial",
    objective: "Atomic truth",
    scope: { in: [], out: [] },
    constraints: [],
    acceptance_criteria: [],
    state_revision: revision("0"),
    state_digest: ZERO_DIGEST,
    last_operation: null,
    active_run: { run_id: "run-a", actor_id: "actor-a", started_by_handoff_id: null },
    evidence: [],
    current_handoff_id: null,
    current_submission_id: null,
    current_decision_id: null,
  });
  await writeFile(join(dossier, "dossier.json"), `${JSON.stringify(initial)}\n`);
  let guard = 0;
  const ports: MutationPorts = {
    fs: controlledAtomicFs(root, fault),
    schemas,
    processIdentity: {
      current: async () => ({ profile: "test-process", pid: "7", process_started_at: "2026-09-04T00:00:00Z" }),
      verifyTerminated: async () => "terminated",
    },
    clock: { now: () => "2026-09-04T00:01:00Z", isPossiblyStale: () => false },
    ids: {
      createGuardId: () => `guard-${++guard}`,
      tempIdFor: (id) => `temp-${id}`,
      envelopeIdFor: (kind, operation) => `${kind}-${operation}`,
    },
  };
  return { root, dossier, initial, store: new CaseStore(root, schemas), ports };
}

function request(basis: DossierSnapshot, operation = "op-snapshot", input?: Digest): GovernedMutationPrecondition {
  return {
    dossier_id: basis.dossier_id,
    expected_revision: basis.state_revision,
    expected_state_digest: basis.state_digest,
    operation_id: operation,
    input_digest: input ?? digestProjection({ operation }),
  };
}

function handoffPlan(
  basis: DossierSnapshot,
  governed: GovernedMutationPrecondition,
  createCounter: { count: number },
): ImmutableEnvelopePlan<HandoffEnvelope & Record<string, never>, DossierSnapshot> {
  const envelopeId = `handoff-${governed.operation_id}`;
  return {
    kind: "handoff",
    envelope_id: envelopeId,
    input_projection: { to_actor_id: "actor-b" },
    create(current) {
      createCounter.count += 1;
      return {
        handoff_id: envelopeId,
        dossier_id: current.dossier_id,
        from_run_id: current.active_run.run_id,
        to_actor_id: "actor-b",
        basis_revision: current.state_revision,
        basis_state_digest: current.state_digest,
        published_revision: revision((BigInt(current.state_revision) + 1n).toString()),
        offered_content_digest: digestProjection(projectContent(current)),
        created_operation_id: governed.operation_id,
      } as HandoffEnvelope & Record<string, never>;
    },
    projectInput: (envelope) => ({ to_actor_id: envelope.to_actor_id }),
    validatePersisted: (envelope, current) => envelope.handoff_id === envelopeId
      && envelope.from_run_id === current.active_run.run_id
      && envelope.to_actor_id === "actor-b"
      && envelope.offered_content_digest === digestProjection(projectContent(current)),
    buildSnapshot: (current, envelope) => {
      const snapshot = advance(current, governed, { current_handoff_id: envelope.handoff_id });
      return { snapshot, data: snapshot };
    },
  };
}

async function acceptsOnlyCompleteSnapshot(store: CaseStore): Promise<boolean> {
  try {
    const snapshot = await store.loadDossier("dossier-a");
    return snapshot.state_digest === digestProjection(projectState(snapshot));
  } catch {
    return false;
  }
}

for (const point of ["after_temp_open", "after_temp_flush", "after_snapshot_replace"] as const) {
  test(`fails closed at ${point}`, async (t) => {
    const { store, ports, initial } = await fixture(t, point);
    const governed = request(initial);
    const guard = await acquireWriterGuard(store, governed, ports);

    const result = await commitSnapshotMutation(guard, (basis) => {
      const snapshot = advance(basis, governed, { title: "Published" });
      return { snapshot, data: snapshot };
    });

    assert.equal(result.ok, false);
    assert.ok(["CASE_E_INTERNAL", "CASE_E_RECOVERY_REQUIRED"].includes(result.code));
    assert.equal(await acceptsOnlyCompleteSnapshot(store), true);
  });
}

test("fails closed at after_envelope_create and leaves the orphan without authority", async (t) => {
  const { dossier, store, ports, initial } = await fixture(t, "after_envelope_create");
  const governed = request(initial, "op-envelope", digestProjection({ to_actor_id: "actor-b" }));
  const guard = await acquireWriterGuard(store, governed, ports);

  const result = await commitEnvelopeMutation(guard, handoffPlan(initial, governed, { count: 0 }));

  assert.equal(result.ok, false);
  assert.ok(["CASE_E_INTERNAL", "CASE_E_RECOVERY_REQUIRED"].includes(result.code));
  assert.equal((await store.loadDossier("dossier-a")).current_handoff_id, null);
  assert.equal((await readFile(join(dossier, "handoffs", "handoff-op-envelope.json"), "utf8")).includes("actor-b"), true);
});

test("an orphan retry reuses persisted envelope values without regenerating volatile fields", async (t) => {
  const { root, store, ports, initial } = await fixture(t, "after_envelope_create");
  const governed = request(initial, "op-envelope", digestProjection({ to_actor_id: "actor-b" }));
  const creates = { count: 0 };
  const firstGuard = await acquireWriterGuard(store, governed, ports);
  assert.equal((await commitEnvelopeMutation(firstGuard, handoffPlan(initial, governed, creates))).ok, false);
  await assert.rejects(readFile(join(root, ".case-agent", "locks", "dossier-a.lock")), { code: "ENOENT" });

  const retryGuard = await acquireWriterGuard(store, governed, ports);
  const retried = await commitEnvelopeMutation(retryGuard, handoffPlan(initial, governed, creates));

  assert.equal(retried.ok, true);
  assert.equal(creates.count, 1);
  assert.equal((await store.loadDossier("dossier-a")).current_handoff_id, "handoff-op-envelope");
});

test("a crash orphan remains inert and formal recovery invalidates its old basis", async (t) => {
  const { dossier, store, ports, initial } = await fixture(t);
  const governed = request(initial, "op-envelope", digestProjection({ to_actor_id: "actor-b" }));
  const plan = handoffPlan(initial, governed, { count: 0 });
  await acquireWriterGuard(store, governed, ports);
  await writeFile(join(dossier, "handoffs", "handoff-op-envelope.json"), `${JSON.stringify(plan.create(initial))}\n`);

  const recovered = await recoverWriterGuard(store, {
    dossier_id: "dossier-a",
    confirmation: { interactive: true, confirmRecovery: async () => true },
  }, ports);
  const retriedGuard = await acquireWriterGuard(store, governed, ports);
  const retried = await commitEnvelopeMutation(retriedGuard, plan);

  assert.equal(recovered.ok, true);
  assert.equal(retried.code, "CASE_E_CONFLICT");
  assert.equal((await store.loadDossier("dossier-a")).current_handoff_id, null);
});

test("an immediate envelope retry fails closed when the persisted envelope was corrupted", async (t) => {
  const { dossier, store, ports, initial } = await fixture(t);
  const governed = request(initial, "op-envelope", digestProjection({ to_actor_id: "actor-b" }));
  const plan = handoffPlan(initial, governed, { count: 0 });
  const firstGuard = await acquireWriterGuard(store, governed, ports);
  assert.equal((await commitEnvelopeMutation(firstGuard, plan)).ok, true);
  await writeFile(join(dossier, "handoffs", "handoff-op-envelope.json"), "{broken");

  const retryGuard = await acquireWriterGuard(store, governed, ports);
  const retried = await commitEnvelopeMutation(retryGuard, plan);

  assert.equal(retried.ok, false);
  assert.ok(["CASE_E_CONFLICT", "CASE_E_RECOVERY_REQUIRED"].includes(retried.code));
});

test("a derived envelope path containing a conflicting internal ID fails closed", async (t) => {
  const { dossier, store, ports, initial } = await fixture(t);
  const governed = request(initial, "op-envelope", digestProjection({ to_actor_id: "actor-b" }));
  const plan = handoffPlan(initial, governed, { count: 0 });
  const conflicting = plan.create(initial);
  conflicting.handoff_id = "handoff-some-other-operation";
  await writeFile(join(dossier, "handoffs", "handoff-op-envelope.json"), `${JSON.stringify(conflicting)}\n`);
  const guard = await acquireWriterGuard(store, governed, ports);

  const result = await commitEnvelopeMutation(guard, plan);

  assert.equal(result.code, "CASE_E_CONFLICT");
  assert.equal((await store.loadDossier("dossier-a")).current_handoff_id, null);
});

test("a valid-schema handoff alteration cannot become authoritative", async (t) => {
  const { dossier, store, ports, initial } = await fixture(t);
  const governed = request(initial, "op-envelope", digestProjection({ to_actor_id: "actor-b" }));
  const plan = handoffPlan(initial, governed, { count: 0 });
  const altered = { ...plan.create(initial), from_run_id: "run-other" };
  await writeFile(join(dossier, "handoffs", "handoff-op-envelope.json"), `${JSON.stringify(altered)}\n`);

  const result = await commitEnvelopeMutation(await acquireWriterGuard(store, governed, ports), plan);

  assert.equal(result.code, "CASE_E_CONFLICT");
  assert.equal((await store.loadDossier("dossier-a")).current_handoff_id, null);
});

test("a valid-schema submission alteration cannot become authoritative", async (t) => {
  const { dossier, store, ports, initial } = await fixture(t);
  const input = { submitting_run_id: "run-a" };
  const governed = request(initial, "op-submission", digestProjection(input));
  const envelopeId = "submission-op-submission";
  const expectedWithoutDigest = {
    submission_id: envelopeId,
    dossier_id: "dossier-a",
    submitting_run_id: "run-a",
    basis_revision: revision("0"),
    basis_state_digest: initial.state_digest,
    published_revision: revision("1"),
    content_digest: digestProjection(projectContent(initial)),
    observed_evidence_digest: digest(`sha256:${"1".repeat(64)}`),
    checks_digest: digest(`sha256:${"2".repeat(64)}`),
    created_at: "2026-09-04T00:01:00Z",
    created_operation_id: "op-submission",
  };
  const expected: SubmissionEnvelope = {
    ...expectedWithoutDigest,
    submission_digest: digestProjection(projectSubmission({ ...expectedWithoutDigest, submission_digest: ZERO_DIGEST })),
  };
  const changedChecks = { ...expected, checks_digest: digest(`sha256:${"3".repeat(64)}`) };
  const altered: SubmissionEnvelope = {
    ...changedChecks,
    submission_digest: digestProjection(projectSubmission(changedChecks)),
  };
  await writeFile(join(dossier, "submissions", `${envelopeId}.json`), `${JSON.stringify(altered)}\n`);
  const plan: ImmutableEnvelopePlan<SubmissionEnvelope & Record<string, never>, DossierSnapshot> = {
    kind: "submission",
    envelope_id: envelopeId,
    input_projection: input,
    create: () => expected as SubmissionEnvelope & Record<string, never>,
    projectInput: (envelope) => ({ submitting_run_id: envelope.submitting_run_id }),
    validatePersisted: (envelope) => envelope.checks_digest === expected.checks_digest
      && envelope.submission_digest === expected.submission_digest,
    buildSnapshot: (current, envelope) => {
      const snapshot = advance(current, governed, { current_submission_id: envelope.submission_id });
      return { snapshot, data: snapshot };
    },
  };

  const result = await commitEnvelopeMutation(await acquireWriterGuard(store, governed, ports), plan);

  assert.equal(result.code, "CASE_E_CONFLICT");
  assert.equal((await store.loadDossier("dossier-a")).current_submission_id, null);
});

test("a valid-schema decision alteration cannot become authoritative", async (t) => {
  const { dossier, store, ports, initial } = await fixture(t);
  const basis = fixed({ ...initial, current_submission_id: "submission-current" });
  await writeFile(join(dossier, "dossier.json"), `${JSON.stringify(basis)}\n`);
  const input = { submission_id: "submission-current", decision: "accepted" };
  const governed = request(basis, "op-decision", digestProjection(input));
  const envelopeId = "decision-op-decision";
  const expected: DecisionEnvelope = {
    decision_id: envelopeId,
    dossier_id: "dossier-a",
    submission_id: "submission-current",
    submission_digest: digest(`sha256:${"4".repeat(64)}`),
    decision: "accepted",
    reviewer_id: "reviewer-a",
    criteria_reviewed: [],
    comment: "accepted",
    decided_at: "2026-09-04T00:01:00Z",
    created_operation_id: "op-decision",
    identity_assurance: "recorded-interactive-claim",
  };
  const altered = { ...expected, submission_id: "submission-other" };
  await writeFile(join(dossier, "decisions", `${envelopeId}.json`), `${JSON.stringify(altered)}\n`);
  const plan: ImmutableEnvelopePlan<DecisionEnvelope & Record<string, never>, DossierSnapshot> = {
    kind: "decision",
    envelope_id: envelopeId,
    input_projection: input,
    create: () => expected as DecisionEnvelope & Record<string, never>,
    projectInput: (envelope) => ({ submission_id: envelope.submission_id, decision: envelope.decision }),
    validatePersisted: (envelope, current) => envelope.submission_id === current.current_submission_id
      && envelope.submission_digest === expected.submission_digest
      && envelope.reviewer_id === expected.reviewer_id
      && envelope.comment === expected.comment,
    buildSnapshot: (current, envelope) => {
      const snapshot = advance(current, governed, { current_decision_id: envelope.decision_id });
      return { snapshot, data: snapshot };
    },
  };

  const result = await commitEnvelopeMutation(await acquireWriterGuard(store, governed, ports), plan);

  assert.equal(result.code, "CASE_E_CONFLICT");
  assert.equal((await store.loadDossier("dossier-a")).current_decision_id, null);
});

test("an invalid next snapshot is rejected before target replacement", async (t) => {
  const { dossier, store, ports, initial } = await fixture(t);
  const before = await readFile(join(dossier, "dossier.json"));
  const governed = request(initial);
  const guard = await acquireWriterGuard(store, governed, ports);

  const result = await commitSnapshotMutation(guard, (basis) => ({ snapshot: { ...basis, title: "not advanced" }, data: basis }));

  assert.equal(result.code, "CASE_E_INTERNAL");
  assert.deepEqual(await readFile(join(dossier, "dossier.json")), before);
});

test("post-replace verification recomputes the published snapshot self-digest", async (t) => {
  const { root, store, ports, initial } = await fixture(t);
  const baseFs = ports.fs;
  const tamperingPorts: MutationPorts = {
    ...ports,
    fs: {
      ...baseFs,
      async replaceCurrent(tempPath, targetPath) {
        await baseFs.replaceCurrent(tempPath, targetPath);
        const publishedPath = join(root, targetPath);
        const published = JSON.parse(await readFile(publishedPath, "utf8")) as DossierSnapshot;
        await writeFile(publishedPath, `${JSON.stringify({ ...published, title: "tampered after replace" })}\n`);
      },
    },
  };
  const governed = request(initial);
  const guard = await acquireWriterGuard(store, governed, tamperingPorts);

  const result = await commitSnapshotMutation(guard, (current) => {
    const snapshot = advance(current, governed, { title: "intended" });
    return { snapshot, data: snapshot };
  });

  assert.equal(result.code, "CASE_E_RECOVERY_REQUIRED");
  assert.equal((await readFile(join(root, ".case-agent", "locks", "dossier-a.lock"), "utf8")).includes("guard_id"), true);
});

test("the bundled Node adapter withholds the unproven Windows replacement profile", () => {
  if (process.platform !== "win32") return;
  assert.deepEqual(nodeAtomicFsPort(process.cwd()).profile, {
    supported: false,
    profile: "node-libuv-movefileexw",
    reason: "windows-node-primitive-unproven",
  });
});
