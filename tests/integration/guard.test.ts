import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { digestProjection } from "../../src/protocol/canonical.js";
import { projectState } from "../../src/protocol/projections.js";
import { SchemaRegistry } from "../../src/protocol/schema-registry.js";
import { digest, revision, type Digest, type DossierSnapshot } from "../../src/protocol/types.js";
import { commitSnapshotMutation } from "../../src/storage/atomic.js";
import {
  acquireWriterGuard,
  recoverWriterGuard,
  type GovernedMutationPrecondition,
  type MutationPorts,
  type RecoverWriterGuardRequest,
  type RecoveryConfirmationPort,
} from "../../src/storage/guard.js";
import { CaseStore } from "../../src/storage/store.js";
import { controlledAtomicFs } from "../helpers/fault-port.js";

const ZERO_DIGEST = digest(`sha256:${"0".repeat(64)}`);
const INPUT_A = digest(`sha256:${"a".repeat(64)}`);
const INPUT_B = digest(`sha256:${"b".repeat(64)}`);
const CONFIRM_RECOVERY: RecoveryConfirmationPort = {
  interactive: true,
  confirmRecovery: async () => true,
};

function recoveryRequest(snapshot: DossierSnapshot, confirmation: RecoveryConfirmationPort = CONFIRM_RECOVERY): RecoverWriterGuardRequest {
  return { dossier_id: snapshot.dossier_id, operation_id: "op-recover", expected_revision: snapshot.state_revision, expected_state_digest: snapshot.state_digest, confirmation };
}

function withStateDigest(snapshot: DossierSnapshot): DossierSnapshot {
  const candidate = { ...snapshot, state_digest: ZERO_DIGEST };
  return { ...candidate, state_digest: digestProjection(projectState(candidate)) };
}

function nextSnapshot(basis: DossierSnapshot, precondition: GovernedMutationPrecondition, title: string): DossierSnapshot {
  const resulting = revision((BigInt(basis.state_revision) + 1n).toString());
  return withStateDigest({
    ...basis,
    title,
    state_revision: resulting,
    last_operation: {
      operation_id: precondition.operation_id,
      input_digest: precondition.input_digest,
      basis_revision: precondition.expected_revision,
      resulting_revision: resulting,
    },
  });
}

async function fixture(t: TestContext) {
  const root = await (await import("node:fs/promises")).mkdtemp(join(process.cwd(), ".tmp-guard-"));
  t.after(async () => (await import("node:fs/promises")).rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".case-agent", "dossiers", "dossier-a"), { recursive: true });
  await mkdir(join(root, ".case-agent", "locks"), { recursive: true });
  for (const child of ["handoffs", "submissions", "decisions"]) {
    await mkdir(join(root, ".case-agent", "dossiers", "dossier-a", child));
  }
  const schemas = await SchemaRegistry.load(join(process.cwd(), "schemas"));
  const initial = withStateDigest({
    dossier_id: "dossier-a",
    title: "Initial",
    objective: "Keep one authoritative state",
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
  await writeFile(join(root, ".case-agent", "dossiers", "dossier-a", "dossier.json"), `${JSON.stringify(initial)}\n`);
  const store = new CaseStore(root, schemas);
  let guardNumber = 0;
  const ports: MutationPorts = {
    fs: controlledAtomicFs(root),
    schemas,
    processIdentity: {
      current: async () => ({ profile: "test-process", pid: "101", process_started_at: "2026-09-04T00:00:00Z" }),
      verifyTerminated: async () => "terminated",
    },
    clock: {
      now: () => "2026-09-04T00:01:00Z",
      isPossiblyStale: (createdAt) => createdAt < "2026-09-04T00:00:30Z",
    },
    ids: {
      createGuardId: () => `guard-${++guardNumber}`,
      tempIdFor: (guardId) => `temp-${guardId}`,
      envelopeIdFor: (kind, operationId) => `${kind}-${operationId}`,
    },
  };
  return { root, schemas, initial, store, ports };
}

function precondition(basis: DossierSnapshot, operationId: string, inputDigest: Digest = INPUT_A): GovernedMutationPrecondition {
  return {
    dossier_id: basis.dossier_id,
    expected_revision: basis.state_revision,
    expected_state_digest: basis.state_digest,
    operation_id: operationId,
    input_digest: inputDigest,
  };
}

async function mutate(
  store: CaseStore,
  ports: MutationPorts,
  basis: DossierSnapshot,
  operationId: string,
) {
  const request = precondition(basis, operationId, operationId === "op-a" ? INPUT_A : INPUT_B);
  const guard = await acquireWriterGuard(store, request, ports);
  return commitSnapshotMutation(guard, (current) => {
    const snapshot = nextSnapshot(current, request, operationId);
    return { snapshot, data: snapshot };
  });
}

test("exactly one conforming writer commits from one basis", async (t) => {
  const { store, ports, initial } = await fixture(t);

  const [a, b] = await Promise.all([
    mutate(store, ports, initial, "op-a"),
    mutate(store, ports, initial, "op-b"),
  ]);

  assert.equal([a, b].filter((result) => result.ok).length, 1);
  const loser = [a, b].find((result) => !result.ok);
  assert.ok(loser !== undefined && ["CASE_E_BUSY", "CASE_E_CONFLICT"].includes(loser.code));
  assert.equal((await store.loadDossier("dossier-a")).state_revision, "1");
});

test("stale preconditions fail before the mutation builder runs", async (t) => {
  const { store, ports, initial } = await fixture(t);
  assert.equal((await mutate(store, ports, initial, "op-a")).ok, true);
  let built = false;

  const guard = await acquireWriterGuard(store, precondition(initial, "op-b", INPUT_B), ports);
  const result = await commitSnapshotMutation(guard, () => {
    built = true;
    throw new Error("must not run");
  });

  assert.equal(result.code, "CASE_E_CONFLICT");
  assert.equal(built, false);
});

test("guard acquisition rejects a stored snapshot whose self-digest no longer matches", async (t) => {
  const { root, store, ports, initial } = await fixture(t);
  await writeFile(
    join(root, ".case-agent", "dossiers", "dossier-a", "dossier.json"),
    `${JSON.stringify({ ...initial, title: "tampered without digest update" })}\n`,
  );
  let built = false;

  const guard = await acquireWriterGuard(store, precondition(initial, "op-a"), ports);
  const result = await commitSnapshotMutation(guard, () => {
    built = true;
    throw new Error("must not run");
  });

  assert.equal(result.code, "CASE_E_INVARIANT");
  assert.equal(built, false);
});

test("immediate identical retry succeeds without a second transition", async (t) => {
  const { store, ports, initial } = await fixture(t);
  const request = precondition(initial, "op-a");
  assert.equal((await mutate(store, ports, initial, "op-a")).ok, true);
  let built = false;

  const guard = await acquireWriterGuard(store, request, ports);
  const result = await commitSnapshotMutation(guard, () => {
    built = true;
    throw new Error("must not rebuild an immediate retry");
  }, (committed) => ({ revision: committed.state_revision, replayed: true as const }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.data, { revision: "1", replayed: true });
  assert.equal(built, false);
  assert.equal((await store.loadDossier("dossier-a")).state_revision, "1");
});

test("reusing an immediate operation ID with different input conflicts", async (t) => {
  const { store, ports, initial } = await fixture(t);
  assert.equal((await mutate(store, ports, initial, "op-a")).ok, true);

  const guard = await acquireWriterGuard(store, precondition(initial, "op-a", INPUT_B), ports);
  const result = await commitSnapshotMutation(guard, () => { throw new Error("must not run"); });

  assert.equal(result.code, "CASE_E_CONFLICT");
});

for (const invalidLastOperation of [
  { state_revision: "1", resulting_revision: "9", label: "resulting revision differs from current revision" },
  { state_revision: "2", resulting_revision: "2", label: "result is not the one-step successor of its basis" },
] as const) {
  test(`immediate retry rejects last_operation when ${invalidLastOperation.label}`, async (t) => {
    const { root, store, ports, initial } = await fixture(t);
    const malformed = withStateDigest({
      ...initial,
      state_revision: revision(invalidLastOperation.state_revision),
      last_operation: {
        operation_id: "op-a",
        input_digest: INPUT_A,
        basis_revision: revision("0"),
        resulting_revision: revision(invalidLastOperation.resulting_revision),
      },
    });
    await writeFile(join(root, ".case-agent", "dossiers", "dossier-a", "dossier.json"), `${JSON.stringify(malformed)}\n`);

    const guard = await acquireWriterGuard(store, precondition(initial, "op-a"), ports);
    const result = await commitSnapshotMutation(guard, () => { throw new Error("must not run"); });

    assert.equal(result.code, "CASE_E_INVARIANT");
  });
}

test("a valid possibly stale lock requires explicit recovery", async (t) => {
  const { root, store, ports, initial } = await fixture(t);
  const lock = {
    kind: "writer",
    guard_id: "old-guard",
    dossier_id: "dossier-a",
    basis_revision: "0",
    basis_state_digest: initial.state_digest,
    operation_id: "old-op",
    input_digest: INPUT_A,
    process_identity: { profile: "test-process", pid: "999", process_started_at: "2026-09-03T23:00:00Z" },
    created_at: "2026-09-04T00:00:00Z",
  };
  await writeFile(join(root, ".case-agent", "locks", "dossier-a.lock"), `${JSON.stringify(lock)}\n`);

  const guard = await acquireWriterGuard(store, precondition(initial, "op-b", INPUT_B), ports);
  const result = await commitSnapshotMutation(guard, () => { throw new Error("must not run"); });

  assert.equal(result.code, "CASE_E_RECOVERY_REQUIRED");
});

for (const identityState of ["live", "unknown"] as const) {
  test(`recovery refuses a ${identityState} recorded process identity`, async (t) => {
    const { root, store, ports, initial } = await fixture(t);
    const held = await acquireWriterGuard(store, precondition(initial, "op-a"), ports);
    const refusingPorts: MutationPorts = {
      ...ports,
      processIdentity: { ...ports.processIdentity, verifyTerminated: async () => identityState },
    };

    const result = await recoverWriterGuard(store, recoveryRequest(initial), refusingPorts);

    assert.equal(result.code, "CASE_E_RECOVERY_REQUIRED");
    assert.equal((await readFile(join(root, ".case-agent", "locks", "dossier-a.lock"), "utf8")).includes("guard_id"), true);
    assert.equal((await commitSnapshotMutation(held, () => { throw new Error("not committed"); })).code, "CASE_E_INTERNAL");
  });
}

test("confirmed recovery of a terminated owner publishes a guarded no-op revision", async (t) => {
  const { root, store, ports, initial } = await fixture(t);
  await acquireWriterGuard(store, precondition(initial, "op-a"), ports);

  const result = await recoverWriterGuard(store, recoveryRequest(initial), ports);

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.data.snapshot.state_revision, "1");
  assert.equal(result.ok && result.data.snapshot.last_operation?.operation_id, "op-recover");
  await assert.rejects(readFile(join(root, ".case-agent", "locks", "dossier-a.lock")), { code: "ENOENT" });
  await assert.rejects(readFile(join(root, ".case-agent", "locks", "dossier-a.recovery.lock")), { code: "ENOENT" });
  assert.equal((await readFile(join(root, ".case-agent", "locks", "dossier-a.lock.quarantine-op-recover"), "utf8")).includes("guard-1"), true);
});

test("identical immediate recovery retry reconstructs the prior success without confirmation or revision", async (t) => {
  const { root, store, ports, initial } = await fixture(t);
  await acquireWriterGuard(store, precondition(initial, "op-held"), ports);
  let confirmations = 0;
  const request = recoveryRequest(initial, { interactive: true, confirmRecovery: async () => { confirmations += 1; return true; } });

  const first = await recoverWriterGuard(store, request, ports);
  const retried = await recoverWriterGuard(store, request, ports);

  assert.equal(first.ok, true);
  assert.equal(retried.ok, true);
  if (!first.ok || !retried.ok) return;
  assert.deepEqual(retried.data, first.data);
  assert.equal(retried.data.snapshot.state_revision, "1");
  assert.equal(confirmations, 1);
  await assert.rejects(readFile(join(root, ".case-agent", "locks", "dossier-a.lock")), { code: "ENOENT" });
  await assert.rejects(readFile(join(root, ".case-agent", "locks", "dossier-a.recovery.lock")), { code: "ENOENT" });
});

test("recovery operation reuse with changed input is invariant while a different operation on the old basis conflicts", async (t) => {
  const { store, ports, initial } = await fixture(t);
  await acquireWriterGuard(store, precondition(initial, "op-held"), ports);
  assert.equal((await recoverWriterGuard(store, recoveryRequest(initial), ports)).ok, true);

  const changedInput = await recoverWriterGuard(store, {
    ...recoveryRequest(initial), expected_state_digest: digest(`sha256:${"c".repeat(64)}`),
  }, ports);
  const differentOperation = await recoverWriterGuard(store, {
    ...recoveryRequest(initial), operation_id: "op-other",
  }, ports);

  assert.equal(changedInput.code, "CASE_E_INVARIANT");
  assert.equal(differentOperation.code, "CASE_E_CONFLICT");
});

test("recovery retry refuses a self-digest-invalid prior result", async (t) => {
  const { root, store, ports, initial } = await fixture(t);
  await acquireWriterGuard(store, precondition(initial, "op-held"), ports);
  const request = recoveryRequest(initial);
  const first = await recoverWriterGuard(store, request, ports);
  assert.equal(first.ok, true); if (!first.ok) return;
  await writeFile(join(root, ".case-agent", "dossiers", "dossier-a", "dossier.json"), `${JSON.stringify({ ...first.data.snapshot, state_digest: ZERO_DIGEST })}\n`);

  const retried = await recoverWriterGuard(store, request, ports);

  assert.equal(retried.code, "CASE_E_INVARIANT");
});

test("recovery acquires its exclusive guard before reading dossier state", async (t) => {
  const { root, schemas, store, ports, initial } = await fixture(t);
  await acquireWriterGuard(store, precondition(initial, "op-a"), ports);
  class OrderingStore extends CaseStore {
    override async loadDossier(id: string): Promise<DossierSnapshot> {
      await readFile(join(root, ".case-agent", "locks", `${id}.recovery.lock`));
      return super.loadDossier(id);
    }
  }

  const result = await recoverWriterGuard(
    new OrderingStore(root, schemas),
    recoveryRequest(initial),
    ports,
  );

  assert.equal(result.ok, true);
});

test("recovery rejects an intervening basis before confirmation or quarantine and releases recovery exclusivity", async (t) => {
  const { root, store, ports, initial } = await fixture(t);
  await acquireWriterGuard(store, precondition(initial, "op-held"), ports);
  let confirmations = 0;
  const result = await recoverWriterGuard(store, {
    ...recoveryRequest(initial, { interactive: true, confirmRecovery: async () => { confirmations += 1; return true; } }),
    expected_revision: revision("1"),
  }, ports);

  assert.equal(result.code, "CASE_E_CONFLICT");
  assert.equal(confirmations, 0);
  assert.equal((await readFile(join(root, ".case-agent", "locks", "dossier-a.lock"), "utf8")).includes("op-held"), true);
  await assert.rejects(readFile(join(root, ".case-agent", "locks", "dossier-a.recovery.lock")), { code: "ENOENT" });
  await assert.rejects(readFile(join(root, ".case-agent", "locks", "dossier-a.lock.quarantine-guard-2")), { code: "ENOENT" });
});

test("recovery refuses a non-interactive confirmation source", async (t) => {
  const { root, store, ports, initial } = await fixture(t);
  await acquireWriterGuard(store, precondition(initial, "op-a"), ports);

  const result = await recoverWriterGuard(store, recoveryRequest(initial, { interactive: false, confirmRecovery: async () => true }), ports);

  assert.equal(result.code, "CASE_E_HUMAN_CONFIRMATION");
  await assert.rejects(readFile(join(root, ".case-agent", "locks", "dossier-a.recovery.lock")), { code: "ENOENT" });
});

test("recovery retains its guard when state becomes self-digest-invalid after quarantine", async (t) => {
  const { root, store, ports, initial } = await fixture(t);
  await acquireWriterGuard(store, precondition(initial, "op-a"), ports);
  const originalFs = ports.fs;
  const corruptingPorts: MutationPorts = {
    ...ports,
    fs: {
      ...originalFs,
      async quarantineOnce(sourcePath, quarantinePath) {
        await originalFs.quarantineOnce(sourcePath, quarantinePath);
        await writeFile(
          join(root, ".case-agent", "dossiers", "dossier-a", "dossier.json"),
          `${JSON.stringify({ ...initial, title: "corrupt after quarantine" })}\n`,
        );
      },
    },
  };

  const result = await recoverWriterGuard(store, recoveryRequest(initial), corruptingPorts);

  assert.equal(result.ok, false);
  assert.ok(["CASE_E_INVARIANT", "CASE_E_RECOVERY_REQUIRED"].includes(result.code));
  assert.equal((await readFile(join(root, ".case-agent", "locks", "dossier-a.recovery.lock"), "utf8")).includes("recovery"), true);
  assert.equal((await store.loadDossier("dossier-a")).state_revision, "0");
});

test("recovery retains its guard when temporary publication cannot start after quarantine", async (t) => {
  const { root, store, ports, initial } = await fixture(t);
  await acquireWriterGuard(store, precondition(initial, "op-a"), ports);
  const failingPorts: MutationPorts = {
    ...ports,
    ids: { ...ports.ids, tempIdFor: () => "../unsafe" },
  };

  const result = await recoverWriterGuard(store, recoveryRequest(initial), failingPorts);

  assert.equal(result.ok, false);
  assert.equal((await readFile(join(root, ".case-agent", "locks", "dossier-a.recovery.lock"), "utf8")).includes("recovery"), true);
  await assert.rejects(readFile(join(root, ".case-agent", "locks", "dossier-a.lock")), { code: "ENOENT" });
  assert.equal((await store.loadDossier("dossier-a")).state_revision, "0");
});
