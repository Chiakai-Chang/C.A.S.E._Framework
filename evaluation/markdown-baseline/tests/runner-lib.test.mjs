import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  atomicPersistRecord,
  buildIntegrityManifest,
  executeRunPlans,
  fetchJsonWithDeadline,
  redactLocalDetails,
  runChildWithDeadline,
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

test("atomic persistence never overwrites an existing record", async () => {
  const directory = await mkdtemp(join(tmpdir(), "case-record-test-"));
  const first = { record_id: "example", value: "first" };
  await atomicPersistRecord(directory, first);

  await assert.rejects(
    atomicPersistRecord(directory, { record_id: "example", value: "second" }),
    /already exists/i,
  );
  assert.deepEqual(JSON.parse(await readFile(join(directory, "example.json"), "utf8")), first);
});

test("concurrent persistence gives one writer authority for a record id", async () => {
  const directory = await mkdtemp(join(tmpdir(), "case-record-race-test-"));
  const attempts = await Promise.allSettled([
    atomicPersistRecord(directory, { record_id: "shared", actor: "a" }),
    atomicPersistRecord(directory, { record_id: "shared", actor: "b" }),
  ]);

  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
  assert.ok(["a", "b"].includes(JSON.parse(await readFile(join(directory, "shared.json"), "utf8")).actor));
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

test("external integrity manifest detects a record changed after hashing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "case-integrity-test-"));
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
