import assert from "node:assert/strict";
import test from "node:test";
import { parseGovernedJson } from "../../src/protocol/json.js";

test("rejects duplicate decoded member names", () => {
  assert.throws(() => parseGovernedJson(Buffer.from('{"a":true,"\\u0061":false}')), /CASE_E_PARSE/);
});

test("rejects every JSON number", () => {
  for (const source of ['{"revision":1}', '[0]', '[-1]', '[1.5]', '[1e2]']) {
    assert.throws(() => parseGovernedJson(Buffer.from(source)), /CASE_E_PARSE/);
  }
});

test("rejects a UTF-8 BOM and malformed UTF-8", () => {
  assert.throws(
    () => parseGovernedJson(Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])),
    /CASE_E_PARSE/,
  );
  assert.throws(() => parseGovernedJson(Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xc3, 0x28, 0x7d])), /CASE_E_PARSE/);
});

test("rejects isolated surrogates and Unicode noncharacters", () => {
  for (const source of ['"\\ud800"', '"\\udc00"', '"\\ufffe"', '"\\ud83f\\udffe"']) {
    assert.throws(() => parseGovernedJson(Buffer.from(source)), /CASE_E_PARSE/);
  }
});

test("rejects comments, trailing commas, and trailing data", () => {
  for (const source of ['{/* no */}', '{"a":true,}', '[true,]', 'true false']) {
    assert.throws(() => parseGovernedJson(Buffer.from(source)), /CASE_E_PARSE/);
  }
});

test("accepts nested number-free JSON", () => {
  assert.deepEqual(parseGovernedJson(Buffer.from('{"a":[true,null,{"b":"x"}]}')), {
    a: [true, null, { b: "x" }],
  });
});
