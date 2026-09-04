import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("case-agent reports a stable version envelope", () => {
  const run = spawnSync(process.execPath, ["dist/src/cli/main.js", "--json", "--version"], {
    encoding: "utf8",
  });
  assert.equal(run.status, 0);
  assert.deepEqual(JSON.parse(run.stdout), {
    ok: true,
    command: "version",
    code: "CASE_OK",
    message: "case-agent 0.1.0-preview",
    data: { version: "0.1.0-preview" },
    remediation: null,
  });
  assert.equal(run.stderr, "");
});
