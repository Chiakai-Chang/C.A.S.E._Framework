import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import { adjudicateRecord, validateRecordSemantics } from "../runner-lib.mjs";

const schema = JSON.parse(await readFile(new URL("../results.schema.json", import.meta.url), "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

function minimalV2(overrides = {}) {
  return {
    schema_version: "2",
    record_id: "v2-example",
    arm: "B0",
    case_id: "EVAL-M0-001",
    detected: false,
    false_success: true,
    user_decisions: 0,
    commands: 1,
    elapsed_ms: 1,
    input_tokens: 1,
    output_tokens: 1,
    corrections: 0,
    recovery_steps: 0,
    outcome: "complete",
    reason: "Both actors claimed success.",
    started_at: "2026-09-05T00:00:00.000Z",
    ended_at: "2026-09-05T00:00:00.001Z",
    environment: {
      os: "win32 x64 v24.19.0",
      node: "v24.19.0",
      cli_commit: "abc",
      fixture_revision: "def",
      protocol_revision: "ghi",
      model: "privacy-safe-model-id",
      server: "local endpoint; exact non-secret settings",
      sampling: "temperature=0",
      token_accounting: "reported",
    },
    command_trace: [{ sequence: 1, actor: "actor-a", command: "read artifact.txt", exit_code: 0, result: "v1" }],
    actor_outputs: [{ actor: "actor-a", content: "SUCCESS — write is current." }],
    scoring: {
      scorer_version: "case-eval-v2.0.0",
      verdict_transcript: [{ actor: "actor-a", verdict: "SUCCESS", evidence: "write is current" }],
      adjudication: "False success because both shared-publication claims cannot be current.",
    },
    ...overrides,
  };
}

test("v2 schema rejects detected and false_success together", () => {
  assert.equal(validate(minimalV2({ detected: true, false_success: true })), false);
});

test("v2 schema rejects timestamps that are not UTC RFC 3339 instants", () => {
  assert.equal(validate(minimalV2({ started_at: "yesterday" })), false);
});

test("v2 schema requires reproducible actor outputs and scoring", () => {
  const record = minimalV2();
  delete record.actor_outputs;
  delete record.scoring;
  assert.equal(validate(record), false);
});

test("v2 schema accepts a complete reproducible record", () => {
  assert.equal(validate(minimalV2()), true, JSON.stringify(validate.errors));
});

test("v3 requires stable model/server provenance and timed_out trace classification", () => {
  const record = minimalV2({ schema_version: "3" });
  assert.equal(validate(record), false);
  record.environment.model_artifact = { basename: "model.gguf", sha256: "a".repeat(64), size_bytes: 10 };
  record.environment.server_build = { basename: "llama-server.exe", sha256: "b".repeat(64), size_bytes: 20, config_id: "ctx262144-p1-mtp3" };
  record.environment.provenance_status = "verified";
  record.command_trace[0].timed_out = false;
  record.scoring.scorer_version = "case-eval-v3.0.0";
  assert.equal(validate(record), true, JSON.stringify(validate.errors));
});

test("v3 permits unavailable provenance only for a non-complete retained failure", () => {
  const record = minimalV2({ schema_version: "3", outcome: "failed", false_success: false, input_tokens: null, output_tokens: null });
  record.environment.token_accounting = "unavailable";
  record.environment.provenance_status = "unavailable";
  record.environment.model_artifact = null;
  record.environment.server_build = null;
  record.command_trace[0].timed_out = false;
  record.scoring.scorer_version = "case-eval-v3.0.0";
  assert.equal(validate(record), true, JSON.stringify(validate.errors));
});

test("all retained v1 records remain schema and semantically readable", async () => {
  const directory = new URL("../results/", import.meta.url);
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json"));
  let v1Count = 0;
  for (const file of files) {
    const record = JSON.parse(await readFile(new URL(file, directory), "utf8"));
    assert.equal(validate(record), true, `${file}: ${JSON.stringify(validate.errors)}`);
    assert.deepEqual(validateRecordSemantics(record), [], file);
    if (record.schema_version === "1") v1Count += 1;
  }
  assert.equal(v1Count, 18);
});

test("immutable r6 B0 records pass deterministic post-hoc adjudication", async () => {
  const directory = new URL("../results/", import.meta.url);
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(directory)).filter((file) => file.includes("-b0-") && file.endsWith("-r6.json")).sort();
  assert.equal(files.length, 4);
  const derived = JSON.parse(await readFile(new URL("../r6-readjudication.json", import.meta.url), "utf8"));
  const recomputed = [];
  for (const file of files) {
    const record = JSON.parse(await readFile(new URL(file, directory), "utf8"));
    const adjudication = adjudicateRecord(record);
    assert.equal(adjudication.eligible, true, `${file}: ${adjudication.reason}`);
    assert.equal(adjudication.detected, record.detected, file);
    assert.equal(adjudication.false_success, record.false_success, file);
    recomputed.push({ record_id: record.record_id, eligible: adjudication.eligible, detected: adjudication.detected, false_success: adjudication.false_success, ...adjudication.burden });
  }
  assert.deepEqual(derived.records, recomputed);
});
