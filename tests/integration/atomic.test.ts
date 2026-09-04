import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { digestProjection } from "../../src/protocol/canonical.js";
import { projectContent, projectState } from "../../src/protocol/projections.js";
import { SchemaRegistry } from "../../src/protocol/schema-registry.js";
import { digest, revision, type Digest, type DossierSnapshot, type HandoffEnvelope } from "../../src/protocol/types.js";
import {
  commitEnvelopeMutation,
  commitSnapshotMutation,
  nodeAtomicFsPort,
  type ImmutableEnvelopePlan,
} from "../../src/storage/atomic.js";
import { acquireWriterGuard, type GovernedMutationPrecondition, type MutationPorts } from "../../src/storage/guard.js";
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
  await unlink(join(root, ".case-agent", "locks", "dossier-a.lock"));

  const retryGuard = await acquireWriterGuard(store, governed, ports);
  const retried = await commitEnvelopeMutation(retryGuard, handoffPlan(initial, governed, creates));

  assert.equal(retried.ok, true);
  assert.equal(creates.count, 1);
  assert.equal((await store.loadDossier("dossier-a")).current_handoff_id, "handoff-op-envelope");
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

test("an invalid next snapshot is rejected before target replacement", async (t) => {
  const { dossier, store, ports, initial } = await fixture(t);
  const before = await readFile(join(dossier, "dossier.json"));
  const governed = request(initial);
  const guard = await acquireWriterGuard(store, governed, ports);

  const result = await commitSnapshotMutation(guard, (basis) => ({ snapshot: { ...basis, title: "not advanced" }, data: basis }));

  assert.equal(result.code, "CASE_E_INTERNAL");
  assert.deepEqual(await readFile(join(dossier, "dossier.json")), before);
});

test("the bundled Node adapter withholds the unproven Windows replacement profile", () => {
  if (process.platform !== "win32") return;
  assert.deepEqual(nodeAtomicFsPort(process.cwd()).profile, {
    supported: false,
    profile: "node-libuv-movefileexw",
    reason: "windows-node-primitive-unproven",
  });
});
