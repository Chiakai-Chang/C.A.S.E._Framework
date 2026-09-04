import { parseArgs } from "node:util";
import { parseGovernedJson, type JsonValue } from "../protocol/json.js";
import { failure, success, type ResultEnvelope } from "../protocol/result.js";
import { isDigest, isRevision, type Digest, type Revision } from "../protocol/types.js";
import type { AcceptanceCriterion, Freshness } from "../protocol/types.js";

interface CliBase { readonly json: boolean; readonly command: string }
interface Basis { readonly expected_revision: Revision; readonly expected_state_digest: Digest }
interface MutationBase extends CliBase {
  readonly dossier_id: string;
  readonly operation_id: string;
  readonly basis: Basis | null;
}

export type CliRequest =
  | (CliBase & { readonly command: "version" })
  | (CliBase & { readonly command: "init"; readonly operation_id: string; readonly start_directory: string })
  | (CliBase & { readonly command: "dossier.create"; readonly operation_id: string; readonly actor_id: string; readonly title: string; readonly objective: string; readonly scope: { in: string[]; out: string[] }; readonly constraints: string[]; readonly acceptance_criteria: AcceptanceCriterion[] })
  | (CliBase & { readonly command: "dossier.show"; readonly dossier_id: string })
  | (CliBase & { readonly command: "dossier.check"; readonly dossier_id: string })
  | (MutationBase & { readonly command: "evidence.add"; readonly run_id: string; readonly evidence: EvidenceInput })
  | (MutationBase & { readonly command: "submission.create"; readonly submitting_run_id: string })
  | (MutationBase & { readonly command: "decision.accept"; readonly submission_id: string; readonly submission_digest: Digest; readonly reviewer_id: string; readonly criteria_reviewed: string[]; readonly comment: string })
  | (MutationBase & { readonly command: "decision.reject"; readonly submission_id: string; readonly submission_digest: Digest; readonly reviewer_id: string; readonly criteria_reviewed: string[]; readonly comment: string })
  | (MutationBase & { readonly command: "handoff.offer"; readonly from_run_id: string; readonly to_actor_id: string })
  | (MutationBase & { readonly command: "handoff.accept"; readonly handoff_id: string; readonly offered_content_digest: Digest; readonly actor_id: string })
  | (MutationBase & { readonly command: "guard.recover" });

type EvidenceCommon = {
  readonly criterion_ids: string[];
  readonly freshness: Freshness;
  readonly limitations: string[];
};
export type EvidenceInput = EvidenceCommon & (
  | { readonly kind: "file" | "command_result"; readonly freshness: "immutable" | "recompute_on_check"; readonly location: { readonly repository_relative_path: string } }
  | { readonly kind: "external_reference"; readonly freshness: "human_review"; readonly location: { readonly uri: string } }
  | { readonly kind: "human_observation"; readonly freshness: "human_review"; readonly location: { readonly statement: string } }
);

type OptionValues = Record<string, string | boolean | undefined>;
const stringOption = { type: "string" as const };

export const MUTATION_BASIS_OPTIONS = { "expected-revision": stringOption, "expected-state-digest": stringOption } as const;
const EXISTING_MUTATION_OPTIONS = { dossier: stringOption, operation: stringOption, ...MUTATION_BASIS_OPTIONS } as const;
export const CLI_OPTIONS = {
  init: { operation: stringOption },
  "dossier.create": { operation: stringOption, actor: stringOption, title: stringOption, objective: stringOption, brief: stringOption },
  "dossier.show": { dossier: stringOption },
  "dossier.check": { dossier: stringOption },
  "evidence.add": { ...EXISTING_MUTATION_OPTIONS, run: stringOption, evidence: stringOption },
  "submission.create": { ...EXISTING_MUTATION_OPTIONS, run: stringOption },
  "decision.accept": { ...EXISTING_MUTATION_OPTIONS, submission: stringOption, "submission-digest": stringOption, reviewer: stringOption, criteria: stringOption, comment: stringOption },
  "decision.reject": { ...EXISTING_MUTATION_OPTIONS, submission: stringOption, "submission-digest": stringOption, reviewer: stringOption, criteria: stringOption, comment: stringOption },
  "handoff.offer": { ...EXISTING_MUTATION_OPTIONS, "from-run": stringOption, "to-actor": stringOption },
  "handoff.accept": { ...EXISTING_MUTATION_OPTIONS, handoff: stringOption, "offered-content-digest": stringOption, actor: stringOption },
  "guard.recover": EXISTING_MUTATION_OPTIONS,
} as const;

function usage(command: string, message: string): ResultEnvelope<never> {
  return failure(command, "CASE_E_USAGE", message);
}

function text(values: OptionValues, name: string): string {
  const value = values[name];
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) throw new Error(`--${name} is required`);
  return value;
}

function opaque(values: OptionValues, name: string): string {
  const value = text(values, name);
  if (!/^[A-Za-z0-9._-]+$/u.test(value) || value === "." || value === "..") throw new Error(`--${name} is malformed`);
  return value;
}

function governed(source: string): JsonValue {
  return parseGovernedJson(Buffer.from(source, "utf8"));
}

function safeOpaqueValue(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/u.test(value) && value !== "." && value !== "..";
}

function record(value: JsonValue): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== "object") throw new Error("JSON object required");
  return value;
}

function exactKeys(value: Record<string, JsonValue>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error("JSON fields are incomplete or unknown");
}

function stringArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0 && !item.includes("\0"))) throw new Error("string array required");
  return [...value] as string[];
}

function parseBrief(source: string): Pick<Extract<CliRequest, { command: "dossier.create" }>, "scope" | "constraints" | "acceptance_criteria"> {
  const value = record(governed(source)); exactKeys(value, ["scope", "constraints", "acceptance_criteria"]);
  const scope = record(value.scope!); exactKeys(scope, ["in", "out"]);
  if (!Array.isArray(value.acceptance_criteria) || value.acceptance_criteria.length === 0) throw new Error("acceptance criteria required");
  const acceptance_criteria = value.acceptance_criteria.map((item) => {
    const criterion = record(item); exactKeys(criterion, ["criterion_id", "statement", "verification"]);
    if (typeof criterion.criterion_id !== "string" || !safeOpaqueValue(criterion.criterion_id) || typeof criterion.statement !== "string" || criterion.statement.length === 0 || (criterion.verification !== "mechanical" && criterion.verification !== "recorded_human_review")) throw new Error("invalid criterion");
    return { criterion_id: criterion.criterion_id, statement: criterion.statement, verification: criterion.verification as AcceptanceCriterion["verification"] };
  });
  return { scope: { in: stringArray(scope.in), out: stringArray(scope.out) }, constraints: stringArray(value.constraints), acceptance_criteria };
}

function parseEvidence(source: string): EvidenceInput {
  const value = record(governed(source)); exactKeys(value, ["kind", "criterion_ids", "freshness", "limitations", "location"]);
  if (value.kind !== "file" && value.kind !== "command_result" && value.kind !== "external_reference" && value.kind !== "human_observation") throw new Error("invalid evidence kind");
  if (value.freshness !== "immutable" && value.freshness !== "recompute_on_check" && value.freshness !== "human_review") throw new Error("invalid freshness");
  const locationValue = record(value.location!);
  const location = Object.fromEntries(Object.entries(locationValue).map(([key, item]) => {
    if (typeof item !== "string" || item.length === 0 || item.includes("\0")) throw new Error("invalid location"); return [key, item];
  }));
  const locationKey = value.kind === "file" || value.kind === "command_result" ? "repository_relative_path" : value.kind === "external_reference" ? "uri" : "statement";
  exactKeys(locationValue, [locationKey]);
  const criterion_ids = stringArray(value.criterion_ids);
  if (criterion_ids.length === 0 || !criterion_ids.every(safeOpaqueValue) || new Set(criterion_ids).size !== criterion_ids.length) throw new Error("invalid criterion ID");
  if (locationKey === "repository_relative_path") {
    const path = location[locationKey]!;
    const parts = path.split("/");
    if (path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/u.test(path) || path.startsWith("//") || parts.some((part) => part === "" || part === "." || part === "..")) throw new Error("unsafe evidence path");
  }
  const limitations = stringArray(value.limitations);
  if (value.kind === "file" || value.kind === "command_result") {
    if (value.freshness !== "immutable" && value.freshness !== "recompute_on_check") throw new Error("invalid freshness for local evidence");
    return { kind: value.kind, criterion_ids, freshness: value.freshness, limitations, location: { repository_relative_path: location.repository_relative_path! } };
  }
  if (value.freshness !== "human_review") throw new Error("invalid freshness for recorded evidence");
  return value.kind === "external_reference"
    ? { kind: value.kind, criterion_ids, freshness: value.freshness, limitations, location: { uri: location.uri! } }
    : { kind: value.kind, criterion_ids, freshness: value.freshness, limitations, location: { statement: location.statement! } };
}

function basis(values: OptionValues, json: boolean): Basis | null {
  const revisionValue = values["expected-revision"];
  const digestValue = values["expected-state-digest"];
  if (revisionValue === undefined && digestValue === undefined) {
    if (json) throw new Error("machine mutations require a complete basis");
    return null;
  }
  if (typeof revisionValue !== "string" || typeof digestValue !== "string" || !isRevision(revisionValue) || !isDigest(digestValue)) throw new Error("mutation basis is malformed or incomplete");
  return { expected_revision: revisionValue, expected_state_digest: digestValue };
}

function commandName(positionals: string[]): { command: keyof typeof CLI_OPTIONS; consumed: number } {
  const one = positionals[0]; const two = positionals[1];
  if (one === "init") return { command: "init", consumed: 1 };
  const joined = `${one}.${two}` as keyof typeof CLI_OPTIONS;
  if (Object.hasOwn(CLI_OPTIONS, joined)) return { command: joined, consumed: 2 };
  throw new Error("unknown or forbidden command");
}

export function parseCliRequest(argv: readonly string[], cwd = process.cwd()): ResultEnvelope<CliRequest> {
  let json = false;
  try {
    const jsonCount = argv.filter((arg) => arg === "--json").length;
    const versionCount = argv.filter((arg) => arg === "--version").length;
    if (jsonCount > 1 || versionCount > 1) throw new Error("duplicate global option");
    json = jsonCount === 1;
    const commandArgs = argv.filter((arg) => arg !== "--json");
    const global = parseArgs({ args: argv.filter((arg) => arg === "--json" || arg === "--version"), options: { json: { type: "boolean" }, version: { type: "boolean" } }, strict: true });
    if (global.values.version === true) {
      if (commandArgs.length !== 1 || commandArgs[0] !== "--version") throw new Error("--version cannot be combined with a command");
      return success("version", "Parsed CLI request", { command: "version", json });
    }
    const leading = commandArgs.filter((arg) => !arg.startsWith("--"));
    const selected = commandName(leading);
    const head = selected.consumed === 1 ? [commandArgs[0]!] : [commandArgs[0]!, commandArgs[1]!];
    if (head.some((value, index) => value !== leading[index])) throw new Error("command must precede command options");
    const parsed = parseArgs({ args: commandArgs.slice(selected.consumed), options: CLI_OPTIONS[selected.command], allowPositionals: true, strict: true });
    if (parsed.positionals.length !== 0) throw new Error("positional extras are forbidden");
    for (const name of Object.keys(parsed.values)) {
      const count = commandArgs.filter((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`)).length;
      if (count !== 1) throw new Error("duplicate option");
    }
    const values = parsed.values as OptionValues;
    const command = selected.command;
    let request: CliRequest;
    if (command === "init") request = { command, json, operation_id: opaque(values, "operation"), start_directory: cwd };
    else if (command === "dossier.create") request = { command, json, operation_id: opaque(values, "operation"), actor_id: text(values, "actor"), title: text(values, "title"), objective: text(values, "objective"), ...parseBrief(text(values, "brief")) };
    else if (command === "dossier.show" || command === "dossier.check") request = { command, json, dossier_id: opaque(values, "dossier") };
    else if (command === "evidence.add") request = { command, json, dossier_id: opaque(values, "dossier"), operation_id: opaque(values, "operation"), basis: basis(values, json), run_id: opaque(values, "run"), evidence: parseEvidence(text(values, "evidence")) };
    else if (command === "submission.create") request = { command, json, dossier_id: opaque(values, "dossier"), operation_id: opaque(values, "operation"), basis: basis(values, json), submitting_run_id: opaque(values, "run") };
    else if (command === "decision.accept" || command === "decision.reject") { const submissionDigest = text(values, "submission-digest"); if (!isDigest(submissionDigest)) throw new Error("invalid submission digest"); const criteriaReviewed = stringArray(governed(text(values, "criteria"))); if (!criteriaReviewed.every(safeOpaqueValue)) throw new Error("invalid criterion ID"); request = { command, json, dossier_id: opaque(values, "dossier"), operation_id: opaque(values, "operation"), basis: basis(values, json), submission_id: opaque(values, "submission"), submission_digest: submissionDigest, reviewer_id: text(values, "reviewer"), criteria_reviewed: criteriaReviewed, comment: text(values, "comment") }; }
    else if (command === "handoff.offer") request = { command, json, dossier_id: opaque(values, "dossier"), operation_id: opaque(values, "operation"), basis: basis(values, json), from_run_id: opaque(values, "from-run"), to_actor_id: text(values, "to-actor") };
    else if (command === "handoff.accept") { const offered = text(values, "offered-content-digest"); if (!isDigest(offered)) throw new Error("invalid content digest"); request = { command, json, dossier_id: opaque(values, "dossier"), operation_id: opaque(values, "operation"), basis: basis(values, json), handoff_id: opaque(values, "handoff"), offered_content_digest: offered, actor_id: text(values, "actor") }; }
    else request = { command, json, dossier_id: opaque(values, "dossier"), operation_id: opaque(values, "operation"), basis: basis(values, json) };
    return success(command, "Parsed CLI request", request);
  } catch (error) {
    return usage("cli", error instanceof Error ? error.message : "Malformed invocation");
  }
}
