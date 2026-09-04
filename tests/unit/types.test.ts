import assert from "node:assert/strict";
import test from "node:test";
import {
  decimalString,
  digest,
  isDecimalString,
  isDigest,
  isRevision,
  revision,
  type Revision,
} from "../../src/protocol/types.js";

test("rejects non-canonical scalar wire values", () => {
  for (const value of ["-1", "01", "1x", "1.0"]) {
    assert.equal(isDecimalString(value), false);
    assert.throws(() => decimalString(value));
    assert.equal(isRevision(value), false);
    assert.throws(() => revision(value));
  }

  for (const value of ["sha256:ABC", "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeg"]) {
    assert.equal(isDigest(value), false);
    assert.throws(() => digest(value));
  }
});

test("constructs opaque scalar values from exact wire values", () => {
  const size = decimalString("42");
  const stateRevision = revision("7");
  const stateDigest = digest("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  const requiresRevision = (value: Revision): Revision => value;

  // @ts-expect-error DecimalString is not a Revision.
  requiresRevision(size);

  assert.equal(isRevision(stateRevision), true);
  assert.equal(stateDigest, "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
});
