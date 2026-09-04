import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchemaObject, ValidateFunction } from "ajv";

const DIALECT = "https://json-schema.org/draft/2020-12/schema";
const SCHEMA_BASE = "https://case-agent.dev/schema/0.1.0-preview/";
const SUPPORTED_PROTOCOL_VERSION = "0.1.0-preview";
const SUPPORTED_PROTOCOL_MAJOR = "0";

export const SCHEMA_KINDS = [
  "manifest",
  "dossier",
  "handoff",
  "submission",
  "decision",
  "result",
  "observed-evidence",
  "checks",
] as const;

export type SchemaKind = (typeof SCHEMA_KINDS)[number];

export type SchemaValidationResult =
  | { ok: true }
  | { ok: false; code: "CASE_E_SCHEMA" | "CASE_E_UNSUPPORTED_VERSION" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function protocolMajor(version: string): string | undefined {
  const separator = version.indexOf(".");
  if (separator <= 0) return undefined;
  const major = version.slice(0, separator);
  return /^[0-9]+$/.test(major) ? major.replace(/^0+(?=[0-9])/, "") : undefined;
}

function hasUnsupportedProtocolMajor(value: unknown): boolean {
  if (!isRecord(value) || typeof value.protocol_version !== "string") return false;
  const major = protocolMajor(value.protocol_version);
  return major !== undefined && major !== SUPPORTED_PROTOCOL_MAJOR;
}

function isRfc3339Utc(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value);
  if (match === null) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year === 0 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysByMonth[month - 1]!;
}

function timestampsAreValid(kind: SchemaKind, value: unknown): boolean {
  if (!isRecord(value)) return true;
  if (kind === "manifest" || kind === "submission") return isRfc3339Utc(value.created_at);
  if (kind === "decision") return isRfc3339Utc(value.decided_at);
  if (kind !== "dossier" || !Array.isArray(value.evidence)) return true;
  return value.evidence.every((entry) => isRecord(entry) && isRfc3339Utc(entry.captured_at));
}

function assertBundledSchema(schema: AnySchemaObject, fileName: string): void {
  if (schema.$schema !== DIALECT || schema.$id !== `${SCHEMA_BASE}${fileName}`) {
    throw new Error(`Invalid bundled schema metadata: ${fileName}`);
  }
}

async function readSchema(directory: string, fileName: string): Promise<AnySchemaObject> {
  const source = await readFile(join(directory, fileName), "utf8");
  const parsed: unknown = JSON.parse(source);
  if (!isRecord(parsed)) throw new Error(`Bundled schema is not an object: ${fileName}`);
  const schema = parsed as AnySchemaObject;
  assertBundledSchema(schema, fileName);
  return schema;
}

export class SchemaRegistry {
  private constructor(private readonly validators: ReadonlyMap<SchemaKind, ValidateFunction>) {}

  static async load(schemaDirectory: string): Promise<SchemaRegistry> {
    const ajv = new Ajv2020({
      strict: true,
      allErrors: true,
      validateFormats: false,
      loadSchema: undefined as never,
    });

    const definitionsFile = "definitions.schema.json";
    ajv.addSchema(await readSchema(schemaDirectory, definitionsFile));

    const validators = new Map<SchemaKind, ValidateFunction>();
    for (const kind of SCHEMA_KINDS) {
      const fileName = `${kind}.schema.json`;
      const schema = await readSchema(schemaDirectory, fileName);
      ajv.addSchema(schema);
      validators.set(kind, ajv.getSchema(`${SCHEMA_BASE}${fileName}`) ?? ajv.compile(schema));
    }
    return new SchemaRegistry(validators);
  }

  has(kind: SchemaKind): boolean {
    return this.validators.has(kind);
  }

  validate(kind: SchemaKind, value: unknown): SchemaValidationResult {
    if (kind === "manifest" && hasUnsupportedProtocolMajor(value)) {
      return { ok: false, code: "CASE_E_UNSUPPORTED_VERSION" };
    }
    const validator = this.validators.get(kind);
    if (validator === undefined || !validator(value) || !timestampsAreValid(kind, value)) {
      return { ok: false, code: "CASE_E_SCHEMA" };
    }
    if (
      kind === "manifest" &&
      isRecord(value) &&
      value.protocol_version !== SUPPORTED_PROTOCOL_VERSION
    ) {
      return { ok: false, code: "CASE_E_SCHEMA" };
    }
    return { ok: true };
  }
}
