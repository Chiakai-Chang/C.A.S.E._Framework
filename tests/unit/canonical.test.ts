import assert from "node:assert/strict";
import test from "node:test";
import { canonicalize, digestProjection } from "../../src/protocol/canonical.js";
import type { JsonValue } from "../../src/protocol/json.js";

test("canonicalizes object keys by UTF-16 code units", () => {
  assert.equal(
    canonicalize({ "😀": "astral", "\ufffd": "bmp", a: true }),
    '{"a":true,"😀":"astral","�":"bmp"}',
  );
});

test("preserves array order and escapes strings with JSON syntax", () => {
  assert.equal(canonicalize(["line\nfeed", false, null]), '["line\\nfeed",false,null]');
});

test("does not normalize Unicode", () => {
  assert.notEqual(digestProjection("é"), digestProjection("e\u0301"));
});

test("rejects runtime numbers at every nesting level", () => {
  assert.throws(
    () => canonicalize({ nested: [1] } as unknown as JsonValue),
    { name: "TypeError", message: "CASE_E_CANONICAL: numbers are forbidden" },
  );
});

test("returns a validated lowercase SHA-256 wire digest", () => {
  assert.equal(
    digestProjection("abc"),
    "sha256:6cc43f858fbb763301637b5af970e2a46b46f461f27e5a0f41e009c59b827b25",
  );
});
