import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  atomicPersistRecord,
  buildIntegrityManifest,
  classifyM0ProcessResult,
  executeRunPlans,
  fetchJsonWithDeadline,
  redactLocalDetails,
  runChildWithDeadline,
  scoreConcurrentPublication,
  snapshotRecords,
  verifyClosedManifest,
  validateRecordSemantics,
  verifyIntegrityManifest,
} from "../runner-lib.mjs";

test("fetch deadline aborts a request that never completes", async () => {
  let observedAbort = false;
  const fetchImpl = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      observedAbort = true;
      reject(init.signal.reason);
    }, { once: true });
  });

  await assert.rejects(
    fetchJsonWithDeadline("http://example.invalid", {}, 20, fetchImpl),
    /deadline/i,
  );
  assert.equal(observedAbort, true);
});

test("child timeout retains partial stdout and classifies timeout", async () => {
  const script = "process.stdout.write('partial-output'); setInterval(() => {}, 1000);";
  const result = await runChildWithDeadline(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    timeoutMs: 100,
  });

  assert.equal(result.timed_out, true);
  assert.equal(result.exit_code, null);
  assert.equal(result.stdout, "partial-output");
});

test("child timeout terminates an owned grandchild before it can write later", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "case-process-tree-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const marker = join(directory, "late-marker.txt");
  const grandchild = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "late"), 600); setInterval(() => {}, 1000);`;
  const parent = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], {stdio:"ignore"}); setInterval(() => {}, 1000);`;
  const result = await runChildWithDeadline(process.execPath, ["-e", parent], { cwd: directory, timeoutMs: 100 });
  assert.equal(result.timed_out, true);
  await new Promise((resolve) => setTimeout(resolve, 800));
  await assert.rejects(access(marker));
});

test("spawn rejection remains independent while a timed peer process tree is cleaned up", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "case-spawn-peer-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const marker = join(directory, "peer-late-marker.txt");
  const grandchild = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "late"), 600); setInterval(() => {}, 1000);`;
  const parent = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], {stdio:"ignore"}); setInterval(() => {}, 1000);`;
  const settled = await Promise.allSettled([
    runChildWithDeadline("case-command-that-does-not-exist", [], { cwd: directory, timeoutMs: 100 }),
    runChildWithDeadline(process.execPath, ["-e", parent], { cwd: directory, timeoutMs: 100 }),
  ]);
  assert.equal(settled[0].status, "rejected");
  assert.equal(settled[1].status, "fulfilled");
  assert.equal(settled[1].value.timed_out, true);
  await new Promise((resolve) => setTimeout(resolve, 800));
  await assert.rejects(access(marker));
});

test("redaction removes worktree, user profile, and username spellings", () => {
  const source = [
    "D:\\MyProject\\C.A.S.E._Framework\\.worktrees\\m0-local-dossier-integrity\\secret.txt",
    "C:\\Users\\User\\.config\\git\\ignore",
    "/home/alice/private/file",
  ].join("\n");

  const redacted = redactLocalDetails(source, {
    roots: ["D:\\MyProject\\C.A.S.E._Framework\\.worktrees\\m0-local-dossier-integrity"],
    usernames: ["User", "alice"],
  });

  assert.equal(redacted.includes("MyProject"), false);
  assert.equal(redacted.includes("\\User\\"), false);
  assert.equal(redacted.includes("/alice/"), false);
  assert.match(redacted, /<worktree>|<user-profile>/);
});

test("atomic persistence never overwrites an existing record", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "case-record-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = { record_id: "example", value: "first" };
  await atomicPersistRecord(directory, first);

  await assert.rejects(
    atomicPersistRecord(directory, { record_id: "example", value: "second" }),
    /already exists/i,
  );
  assert.deepEqual(JSON.parse(await readFile(join(directory, "example.json"), "utf8")), first);
});

test("serialization failure leaves no temporary or target record", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "case-record-serialization-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(atomicPersistRecord(directory, { record_id: "broken", value: 1n }), /BigInt/u);
  assert.deepEqual(await readdir(directory), []);
});

test("concurrent persistence gives one writer authority for a record id", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "case-record-race-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const attempts = await Promise.allSettled([
    atomicPersistRecord(directory, { record_id: "shared", actor: "a" }),
    atomicPersistRecord(directory, { record_id: "shared", actor: "b" }),
  ]);

  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
  assert.ok(["a", "b"].includes(JSON.parse(await readFile(join(directory, "shared.json"), "utf8")).actor));
});

test("atomic persistence works on the repository filesystem used for results", async (t) => {
  const directory = await mkdtemp(join(import.meta.dirname, "..", ".case-record-worktree-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await atomicPersistRecord(directory, { record_id: "worktree", value: "complete" });
  assert.deepEqual(JSON.parse(await readFile(join(directory, "worktree.json"), "utf8")), { record_id: "worktree", value: "complete" });
  assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".tmp")), []);
});

test("an abandoned Windows reservation fails closed without overwriting", { skip: process.platform !== "win32" }, async (t) => {
  const directory = await mkdtemp(join(import.meta.dirname, "..", ".case-record-stale-lock-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(directory, ".stale.lock")));
  await assert.rejects(atomicPersistRecord(directory, { record_id: "stale", value: "new" }), /stale reservation requiring recovery/u);
  await assert.rejects(access(join(directory, "stale.json")));
  assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".tmp")), []);
});

test("semantic validation rejects contradictory and structurally misleading records", () => {
  const record = {
    schema_version: "2",
    detected: true,
    false_success: true,
    commands: 2,
    command_trace: [{ sequence: 2 }],
    started_at: "not-a-time",
    ended_at: "2026-09-05T00:00:00.000Z",
    input_tokens: null,
    output_tokens: 1,
    outcome: "invalid",
    environment: { token_accounting: "reported" },
  };

  assert.deepEqual(validateRecordSemantics(record), [
    "detected and false_success are mutually exclusive",
    "commands must equal command_trace length",
    "command_trace sequences must be contiguous and unique from 1",
    "started_at must be an RFC 3339 UTC instant",
    "reported token accounting requires both token counts",
    "invalid outcome cannot claim detection or false success",
  ]);
});

test("semantic validation accepts unavailable paired null tokens and ordered trace", () => {
  const record = {
    schema_version: "2",
    detected: false,
    false_success: false,
    commands: 1,
    command_trace: [{ sequence: 1 }],
    started_at: "2026-09-05T00:00:00.000Z",
    ended_at: "2026-09-05T00:00:00.001Z",
    input_tokens: null,
    output_tokens: null,
    outcome: "invalid",
    environment: { token_accounting: "unavailable" },
  };

  assert.deepEqual(validateRecordSemantics(record), []);
});

test("semantic validation rejects reversed time and unavailable non-null tokens", () => {
  const record = {
    schema_version: "2",
    detected: false,
    false_success: false,
    commands: 0,
    command_trace: [],
    started_at: "2026-09-05T00:00:01.000Z",
    ended_at: "2026-09-05T00:00:00.000Z",
    input_tokens: 1,
    output_tokens: null,
    outcome: "failed",
    environment: { token_accounting: "unavailable" },
  };

  assert.deepEqual(validateRecordSemantics(record), [
    "ended_at must not precede started_at",
    "unavailable token accounting requires null token counts",
  ]);
});

test("per-plan failure persists partial redacted evidence and later plans still run", async () => {
  const persisted = [];
  const plans = [{ id: "first" }, { id: "second" }];
  await executeRunPlans(plans, {
    execute: async (plan, partial) => {
      partial.command_trace.push({ sequence: 1, result: "C:\\Users\\User\\private" });
      if (plan.id === "first") throw new Error("failed at C:\\Users\\User\\private");
      return { record_id: "second", command_trace: partial.command_trace };
    },
    makeFailure: (plan, partial, error) => ({ record_id: plan.id, outcome: "failed", reason: error.message, command_trace: partial.command_trace }),
    persist: async (record) => { persisted.push(record); },
    redactOptions: { usernames: ["User"] },
  });

  assert.equal(persisted.length, 2);
  assert.equal(persisted[0].outcome, "failed");
  assert.equal(JSON.stringify(persisted).includes("\\User\\"), false);
  assert.equal(persisted[1].record_id, "second");
});

test("persistence failure is reported and later plans still attempt persistence", async () => {
  const persisted = [];
  const terminal = [];
  const result = await executeRunPlans([{ id: "first" }, { id: "second" }], {
    execute: async (plan) => ({ record_id: plan.id }),
    makeFailure: () => assert.fail("execution should not fail"),
    persist: async (record) => {
      if (record.record_id === "first") throw new Error("disk unavailable");
      persisted.push(record.record_id);
    },
    onPersistenceFailure: (failure) => terminal.push(failure),
  });
  assert.deepEqual(persisted, ["second"]);
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.persistence_failures, [{ record_id: "first", error: "persistence failed: disk unavailable" }]);
  assert.deepEqual(terminal, result.persistence_failures);
});

test("timed-out publication cannot earn detection", () => {
  const result = scoreConcurrentPublication([
    { actor: "actor-a", exit_code: 0, timed_out: false },
    { actor: "actor-b", exit_code: null, timed_out: true },
  ], [
    { actor: "actor-a", verdict: "SUCCESS" },
    { actor: "actor-b", verdict: "DETECTED" },
  ]);
  assert.deepEqual(result, { outcome: "timeout", detected: false, false_success: false, winners: ["actor-a"], losers: [] });
});

test("M0 process hang is timeout rather than unsupported invalid", () => {
  assert.deepEqual(classifyM0ProcessResult({ timed_out: true, exit_code: null, stdout: "" }), {
    outcome: "timeout", expected_unsupported: false, code: "unparseable",
  });
});

test("closed manifest rejects duplicate, dropped, and relabeled entries", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "case-closed-manifest-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = join(directory, "first.json");
  const second = join(directory, "second.json");
  await writeFile(first, "{\"record_id\":\"first\",\"environment\":{\"protocol_revision\":\"p1\"}}\n");
  await writeFile(second, "{\"record_id\":\"second\",\"environment\":{\"protocol_revision\":\"p2\"}}\n");
  const snapshots = await snapshotRecords([first, second], { root: directory });
  const entry = (snapshot, status) => ({
    record_path: snapshot.record_path, sha256: snapshot.sha256, git_blob: snapshot.git_blob,
    record_git_commit: `commit-${snapshot.record.record_id}`, protocol_revision: snapshot.record.environment.protocol_revision,
    status, status_reason: `reason-${status}`,
  });
  const manifest = { records: [entry(snapshots[0], "eligible"), entry(snapshots[1], "invalid")] };
  const policy = (record) => record.record_id === "first" ? ["eligible", "reason-eligible"] : ["invalid", "reason-invalid"];
  const firstCommit = async (recordPath) => `commit-${recordPath.slice(0, -5)}`;
  assert.deepEqual(await verifyClosedManifest(manifest, snapshots, { policy, firstCommit }), []);
  assert.ok((await verifyClosedManifest({ records: [manifest.records[0], manifest.records[0]] }, snapshots, { policy, firstCommit })).some((error) => /duplicate/u.test(error)));
  assert.ok((await verifyClosedManifest({ records: [manifest.records[0]] }, snapshots, { policy, firstCommit })).some((error) => /set mismatch/u.test(error)));
  const relabeled = structuredClone(manifest);
  relabeled.records[0].status = "invalid";
  assert.ok((await verifyClosedManifest(relabeled, snapshots, { policy, firstCommit })).some((error) => /status mismatch/u.test(error)));
});

test("record snapshot uses one buffer for parsing and hashing despite later mutation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "case-snapshot-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "one.json");
  await writeFile(path, "{\"record_id\":\"one\"}\n");
  let reads = 0;
  const snapshots = await snapshotRecords([path], {
    root: directory,
    readFileFn: async (target) => {
      reads += 1;
      const buffer = await readFile(target);
      await writeFile(target, "{\"record_id\":\"mutated\"}\n");
      return buffer;
    },
  });
  assert.equal(reads, 1);
  assert.equal(snapshots[0].record.record_id, "one");
  assert.match(snapshots[0].sha256, /^[0-9a-f]{64}$/u);
});

test("external integrity manifest detects a record changed after hashing", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "case-integrity-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const recordPath = join(directory, "record.json");
  await writeFile(recordPath, "{\"record_id\":\"record\"}\n", "utf8");
  const manifest = await buildIntegrityManifest([{ path: recordPath, record_git_commit: "abc", status: "eligible" }], {
    root: directory,
    protocol_revision: "protocol-commit",
  });

  assert.equal(manifest.records[0].record_path, "record.json");
  assert.match(manifest.records[0].sha256, /^[0-9a-f]{64}$/u);
  assert.match(manifest.records[0].git_blob, /^[0-9a-f]{40}$/u);
  assert.deepEqual(await verifyIntegrityManifest(manifest, { root: directory }), []);

  await writeFile(recordPath, "{\"record_id\":\"changed\"}\n", "utf8");
  assert.deepEqual(await verifyIntegrityManifest(manifest, { root: directory }), ["record.json: sha256 mismatch", "record.json: git blob mismatch"]);
});
