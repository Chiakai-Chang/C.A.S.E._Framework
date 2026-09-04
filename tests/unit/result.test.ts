import assert from "node:assert/strict";
import test from "node:test";
import { failure } from "../../src/protocol/result.js";

test("failure envelopes contain one safe remediation", () => {
  assert.deepEqual(failure("dossier.show", "CASE_E_NOT_INITIALIZED", "Not initialized", "Run case-agent init."), {
    ok: false,
    command: "dossier.show",
    code: "CASE_E_NOT_INITIALIZED",
    message: "Not initialized",
    data: null,
    remediation: "Run case-agent init.",
  });
});
