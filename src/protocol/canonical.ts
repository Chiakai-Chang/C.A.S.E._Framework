import { createHash } from "node:crypto";
import { digest, type Digest } from "./types.js";
import type { JsonValue } from "./json.js";

function compareUtf16CodeUnits(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function canonicalizeValue(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    throw new TypeError("CASE_E_CANONICAL: numbers are forbidden");
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeValue).join(",")}]`;
  }
  if (typeof value !== "object") {
    throw new TypeError("CASE_E_CANONICAL: value is not a number-free JSON value");
  }

  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort(compareUtf16CodeUnits);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeValue(objectValue[key])}`).join(",")}}`;
}

/** Serialize a number-free protocol value using the RFC 8785 ordering rules used by M0. */
export function canonicalize(value: JsonValue): string {
  return canonicalizeValue(value);
}

/** Return the validated SHA-256 wire digest of a canonical digest projection. */
export function digestProjection(value: JsonValue): Digest {
  const hex = createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
  return digest(`sha256:${hex}`);
}
