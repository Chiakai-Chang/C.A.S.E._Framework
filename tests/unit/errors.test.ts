import assert from "node:assert/strict";
import test from "node:test";
import { exitCodeFor } from "../../src/protocol/errors.js";

test("maps conflict errors to process class 30", () => {
  assert.equal(exitCodeFor("CASE_E_CONFLICT"), 30);
});

test("maps unsupported platform profiles to environment process class 10", () => {
  assert.equal(exitCodeFor("CASE_E_UNSUPPORTED_PROFILE"), 10);
});
