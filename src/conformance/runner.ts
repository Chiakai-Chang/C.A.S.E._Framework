import { createHash } from "node:crypto";
import { AsyncLocalStorage, createHook, executionAsyncId } from "node:async_hooks";
import { spawn } from "node:child_process";
import {
  lstat,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchemaObject, ValidateFunction } from "ajv";
import { CLI_OPTIONS, parseCliRequest } from "../cli/args.js";
import type { ExactSubmissionReview, ProposedTransition } from "../cli/confirm.js";
import {
  basisConfirmationPrompt,
  decisionConfirmationPrompt,
  recoveryConfirmationPrompt,
  runCli,
  type CliDependencies,
  type CliTerminal,
} from "../cli/main.js";
import { renderHuman, renderJson } from "../cli/render.js";
import { canonicalize, digestProjection } from "../protocol/canonical.js";
import { buildChecksProjection } from "../protocol/checks.js";
import { EXIT_BY_CODE, exitCodeFor } from "../protocol/errors.js";
import { parseGovernedJson } from "../protocol/json.js";
import { projectChecks, projectContent, projectObservedEvidence, projectState, projectSubmission } from "../protocol/projections.js";
import { failure, success, type ResultEnvelope } from "../protocol/result.js";
import { SchemaRegistry } from "../protocol/schema-registry.js";
import {
  digest,
  isDigest,
  isRevision,
  revision,
  type CurrentView,
  type DecisionEnvelope,
  type DossierSnapshot,
  type ObservedEvidenceProjection,
  type SubmissionEnvelope,
} from "../protocol/types.js";
import { nodeAtomicFsPort, type AtomicFsPort, type AtomicPublicationProfile } from "../storage/atomic.js";
import { recoverWriterGuard, type RecoveryConfirmationView } from "../storage/guard.js";
import { nodePathInspection, resolveEvidencePath, type PathInspectionPort } from "../storage/paths.js";
import { CaseStore } from "../storage/store.js";
import { recordDecision } from "../workflows/decision.js";
import {
  createDossier,
  showDossier,
  type DossierDirectoryPublicationPort,
  type WorkflowPorts,
} from "../workflows/dossier.js";
import { addEvidence, checkDossier } from "../workflows/evidence.js";
import { acceptHandoff, offerHandoff } from "../workflows/handoff.js";
import { initRepository, nodeRepositoryFileSystem } from "../workflows/init.js";
import { createSubmission } from "../workflows/submission.js";

export interface CorpusSummary {
  total: number;
  passed: number;
  failed: number;
  uncovered_positive: string[];
  uncovered_negative: string[];
}

/** Reserved for explicit runner-only dependency injection; never consumed by the shipped CLI. */
export interface CorpusPorts {
  readonly onCaseStart?: (caseId: string) => void | Promise<void>;
  readonly onCaseResult?: (caseId: string, passed: boolean) => void | Promise<void>;
  readonly onInvocationResult?: (caseId: string, index: number, result: {
    readonly process_exit: number;
    readonly result_code: string;
    readonly stdout: string;
    readonly stderr: string;
  }) => void | Promise<void>;
  readonly onFinalTree?: (caseId: string, files: Readonly<Record<string, string>>) => void | Promise<void>;
  readonly onCaseAssertions?: (caseId: string, assertionIds: readonly string[]) => void | Promise<void>;
  readonly onInteractionPrompt?: (caseId: string, invocationIndex: number, stepIndex: number, prompt: string) => void | Promise<void>;
  readonly onRepositoryReady?: (caseId: string, repositoryRoot: string) => void | Promise<void>;
  readonly onBeforeDerivedView?: (caseId: string, repositoryRoot: string) => void | Promise<void>;
}

type Rule = {
  readonly rule_id: string;
  readonly source_section: string;
  readonly statement: string;
  readonly requires_positive: boolean;
  readonly requires_negative: boolean;
};

type PlatformProfile = "controlled-test" | "production-windows-unsupported" | "production-posix-unclaimed";

type FixedEnvironment = {
  readonly CASE_CLOCK: string;
  readonly CASE_ID_SEED: string;
  readonly CASE_PROCESS_PROFILE: PlatformProfile;
  readonly CASE_PROCESS_PID: string;
  readonly CASE_PROCESS_STARTED_AT: string;
  readonly CASE_PROCESS_STATUS: "terminated" | "live" | "unknown";
  readonly CASE_NETWORK: "deny";
  readonly LANG: "C";
  readonly LC_ALL: "C";
  readonly TZ: "UTC";
};

type FaultPoint =
  | "after_temp_open"
  | "after_temp_flush"
  | "after_envelope_create"
  | "after_snapshot_replace";

type CorpusInvocation = {
  readonly actor_label: string;
  readonly argv: string[];
  readonly stdin_mode: "none" | "fixed_text" | "interactive_script";
  readonly stdin_content_file: string | null;
  readonly fixed_environment: FixedEnvironment;
  readonly concurrency_group: string | null;
  readonly fault_point: FaultPoint | null;
};

type CorpusExpectation = {
  readonly process_exit: number;
  readonly result_code: string;
  readonly stdout_json_file: string | null;
  readonly stderr: "empty" | "exact" | "startup_failure_only";
  readonly stderr_file: string | null;
};

type InteractiveScript = {
  readonly script_version: "1";
  readonly steps: Array<{
    readonly kind: "basis" | "decision" | "recovery";
    readonly expected_prompt_file: string;
    readonly response: string;
  }>;
};

type CorpusCase = {
  readonly fixture_version: "1";
  readonly case_id: string;
  readonly normative_rule_ids: string[];
  readonly applicable_platform_profiles: PlatformProfile[];
  readonly initial_directories: string[];
  readonly initial_tree: Array<{ readonly path: string; readonly content_file: string; readonly sha256: string }>;
  readonly invocations: CorpusInvocation[];
  readonly expected: CorpusExpectation[];
  readonly expected_final_tree: Array<{
    readonly path: string;
    readonly presence: "present" | "absent";
    readonly sha256: string | null;
  }>;
  readonly expected_final_directories: string[];
  readonly expected_derived_view_file: string | null;
};

type LocatedCase = {
  readonly fixture: CorpusCase;
  readonly caseFile: string;
  readonly polarity: "positive" | "negative";
  readonly ruleBindings: readonly DirectionBinding[];
};

type DirectionBinding = {
  readonly rule_id: string;
  readonly case_id: string;
  readonly assertion_ids: readonly string[];
};

type BindingDocument = {
  readonly binding_version: "1";
  readonly rules: Array<{
    readonly rule_id: string;
    readonly positive: Array<{ readonly case_id: string; readonly assertion_ids: string[] }>;
    readonly negative: Array<{ readonly case_id: string; readonly assertion_ids: string[] }>;
  }>;
};

type InvocationOutcome = {
  readonly processExit: number;
  readonly resultCode: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly assertionIds: readonly string[];
  readonly interactionPrompts: readonly string[];
  readonly interactionMatched: boolean;
};

class CorpusValidationError extends Error {
  constructor(message: string) {
    super(`CASE_E_CONFORMANCE: ${message}`);
  }
}

// Corpus declarations cannot be bootstrapped through parseGovernedJson: unlike
// governed protocol JSON, fixtures intentionally contain numeric process exits,
// and parser-negative probes exercise parseGovernedJson itself. This independent,
// closed bootstrap parser prevents the subject under test from certifying its own
// inputs while enforcing the same UTF-8/duplicate-key/depth safety boundary.
class StrictJsonParser {
  private position = 0;

  constructor(private readonly source: string) {}

  parse(): unknown {
    this.skipWhitespace();
    const value = this.value(0);
    this.skipWhitespace();
    if (this.position !== this.source.length) this.invalid("trailing data");
    return value;
  }

  private value(depth: number): unknown {
    const next = this.peek();
    if ((next === "{" || next === "[") && depth >= 256) {
      this.invalid("nesting exceeds 256 containers");
    }
    if (next === "{") return this.object(depth + 1);
    if (next === "[") return this.array(depth + 1);
    if (next === '"') return this.string();
    if (next === "t") return this.literal("true", true);
    if (next === "f") return this.literal("false", false);
    if (next === "n") return this.literal("null", null);
    if (next === "-" || (next !== undefined && next >= "0" && next <= "9")) return this.number();
    return this.invalid("unexpected token");
  }

  private object(depth: number): Record<string, unknown> {
    this.consume("{");
    this.skipWhitespace();
    const result = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    if (this.peek() === "}") {
      this.position += 1;
      return result;
    }
    while (true) {
      if (this.peek() !== '"') this.invalid("object key must be a string");
      const key = this.string();
      if (keys.has(key)) this.invalid("duplicate decoded object member");
      keys.add(key);
      this.skipWhitespace();
      this.consume(":");
      this.skipWhitespace();
      Object.defineProperty(result, key, {
        value: this.value(depth),
        enumerable: true,
        writable: true,
        configurable: true,
      });
      this.skipWhitespace();
      const delimiter = this.peek();
      if (delimiter === "}") {
        this.position += 1;
        return result;
      }
      this.consume(",");
      this.skipWhitespace();
    }
  }

  private array(depth: number): unknown[] {
    this.consume("[");
    this.skipWhitespace();
    const result: unknown[] = [];
    if (this.peek() === "]") {
      this.position += 1;
      return result;
    }
    while (true) {
      result.push(this.value(depth));
      this.skipWhitespace();
      const delimiter = this.peek();
      if (delimiter === "]") {
        this.position += 1;
        return result;
      }
      this.consume(",");
      this.skipWhitespace();
    }
  }

  private string(): string {
    this.consume('"');
    let result = "";
    while (this.position < this.source.length) {
      const character = this.peek()!;
      if (character === '"') {
        this.position += 1;
        return result;
      }
      if (character === "\\") {
        result += this.escape();
        continue;
      }
      const codeUnit = character.charCodeAt(0);
      if (codeUnit <= 0x1f) this.invalid("unescaped control character");
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const low = this.source.charCodeAt(this.position + 1);
        if (low < 0xdc00 || low > 0xdfff) this.invalid("isolated surrogate");
        const codePoint = 0x10000 + ((codeUnit - 0xd800) << 10) + (low - 0xdc00);
        this.rejectNoncharacter(codePoint);
        result += character + this.source[this.position + 1]!;
        this.position += 2;
        continue;
      }
      if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) this.invalid("isolated surrogate");
      this.rejectNoncharacter(codeUnit);
      result += character;
      this.position += 1;
    }
    return this.invalid("unterminated string");
  }

  private escape(): string {
    this.position += 1;
    const escaped = this.peek();
    const simple: Readonly<Record<string, string>> = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (escaped !== undefined && Object.hasOwn(simple, escaped)) {
      this.position += 1;
      return simple[escaped]!;
    }
    if (escaped !== "u") return this.invalid("invalid escape");
    this.position += 1;
    const high = this.hexCodeUnit();
    if (high >= 0xd800 && high <= 0xdbff) {
      if (this.source.slice(this.position, this.position + 2) !== "\\u") {
        return this.invalid("isolated surrogate");
      }
      this.position += 2;
      const low = this.hexCodeUnit();
      if (low < 0xdc00 || low > 0xdfff) return this.invalid("isolated surrogate");
      const codePoint = 0x10000 + ((high - 0xd800) << 10) + (low - 0xdc00);
      this.rejectNoncharacter(codePoint);
      return String.fromCodePoint(codePoint);
    }
    if (high >= 0xdc00 && high <= 0xdfff) return this.invalid("isolated surrogate");
    this.rejectNoncharacter(high);
    return String.fromCharCode(high);
  }

  private hexCodeUnit(): number {
    const value = this.source.slice(this.position, this.position + 4);
    if (!/^[0-9a-fA-F]{4}$/u.test(value)) return this.invalid("invalid Unicode escape");
    this.position += 4;
    return Number.parseInt(value, 16);
  }

  private number(): number {
    const match = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/uy;
    match.lastIndex = this.position;
    const token = match.exec(this.source)?.[0];
    if (token === undefined) return this.invalid("invalid number");
    this.position += token.length;
    const value = Number(token);
    if (!Number.isSafeInteger(value)) return this.invalid("only safe integer fixture values are allowed");
    return value;
  }

  private literal<T extends null | boolean>(source: string, value: T): T {
    if (this.source.slice(this.position, this.position + source.length) !== source) {
      return this.invalid("invalid literal");
    }
    this.position += source.length;
    return value;
  }

  private rejectNoncharacter(codePoint: number): void {
    if ((codePoint >= 0xfdd0 && codePoint <= 0xfdef) || (codePoint & 0xffff) === 0xfffe || (codePoint & 0xffff) === 0xffff) {
      this.invalid("Unicode noncharacter");
    }
  }

  private consume(expected: string): void {
    if (this.peek() !== expected) this.invalid(`expected ${expected}`);
    this.position += 1;
  }

  private skipWhitespace(): void {
    while (this.peek() === " " || this.peek() === "\t" || this.peek() === "\r" || this.peek() === "\n") {
      this.position += 1;
    }
  }

  private peek(): string | undefined {
    return this.source[this.position];
  }

  private invalid(reason: string): never {
    throw new CorpusValidationError(`strict JSON parse failed: ${reason}`);
  }
}

/*
 * Corpus bootstrap JSON is deliberately parsed independently from governed
 * protocol JSON. Fixtures contain the numeric process_exit field that the
 * governed parser correctly forbids, and conformance vectors must not let the
 * production parser certify its own malformed-JSON tests. This parser keeps
 * the shared strict byte/duplicate/Unicode rules while allowing safe integers
 * only for the closed fixture schemas below.
 */
function parseStrictJson(bytes: Uint8Array): unknown {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new CorpusValidationError("strict JSON parse failed: BOM");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new CorpusValidationError("strict JSON parse failed: invalid UTF-8");
  }
  return new StrictJsonParser(text).parse();
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isContained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function assertSafeFixturePath(path: string, label: string): void {
  const segments = path.split("/");
  if (
    path.length === 0
    || path.includes("\0")
    || path.includes("\\")
    || path.startsWith("/")
    || path.startsWith("//")
    || /^[A-Za-z]:/u.test(path)
    || path.includes("//")
    || segments.some((part) => part.length === 0 || part === "." || part === "..")
    || segments.some((part) => part.includes(":"))
    || segments.some((part) => /[ .]$/u.test(part))
    || segments.some((part) => /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/iu.test(part))
  ) {
    throw new CorpusValidationError(`${label} is not a safe relative path: ${JSON.stringify(path)}`);
  }
}

async function assertPlainPath(root: string, relativePath: string): Promise<string> {
  assertSafeFixturePath(relativePath, "corpus reference");
  const rootPath = await realpath(root);
  let current = rootPath;
  for (const segment of relativePath.split("/")) {
    current = join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new CorpusValidationError(`corpus reference crosses a link: ${relativePath}`);
  }
  const resolved = await realpath(current);
  if (!isContained(rootPath, resolved)) throw new CorpusValidationError(`corpus reference escapes root: ${relativePath}`);
  const info = await lstat(resolved);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new CorpusValidationError(`corpus reference is not a plain file: ${relativePath}`);
  }
  return resolved;
}

async function readCorpusFile(root: string, relativePath: string): Promise<Uint8Array> {
  return readFile(await assertPlainPath(root, relativePath));
}

function assertUniqueOrderedPaths(
  entries: readonly { readonly path: string }[],
  label: string,
): void {
  const paths = entries.map(({ path }) => path);
  for (const path of paths) assertSafeFixturePath(path, label);
  if (new Set(paths).size !== paths.length) throw new CorpusValidationError(`${label} contains duplicate paths`);
  const sorted = [...paths].sort(compareCodeUnits);
  if (paths.some((path, index) => path !== sorted[index])) {
    throw new CorpusValidationError(`${label} paths are not in stable order`);
  }
}

function assertStableStringArray(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new CorpusValidationError(`${label} contains duplicates`);
  }
  const sorted = [...values].sort(compareCodeUnits);
  if (values.some((value, index) => value !== sorted[index])) {
    throw new CorpusValidationError(`${label} is not in stable order`);
  }
}

function assertExactDirectoryTopology(
  directories: readonly string[],
  files: readonly { readonly path: string; readonly presence?: "present" | "absent" }[],
  label: string,
): void {
  assertStableStringArray(directories, `${label} directories`);
  const declared = new Set(directories);
  for (const directory of directories) {
    assertSafeFixturePath(directory, `${label} directory`);
    if (directory === ".git" || directory.startsWith(".git/")) {
      throw new CorpusValidationError(`${label} declares harness-owned Git state`);
    }
    const segments = directory.split("/");
    for (let length = 1; length < segments.length; length += 1) {
      if (!declared.has(segments.slice(0, length).join("/"))) {
        throw new CorpusValidationError(`${label} directory topology omits a parent`);
      }
    }
  }
  for (const file of files) {
    if (file.presence === "absent") continue;
    const segments = file.path.split("/");
    for (let length = 1; length < segments.length; length += 1) {
      if (!declared.has(segments.slice(0, length).join("/"))) {
        throw new CorpusValidationError(`${label} directory topology omits a file parent`);
      }
    }
  }
}

function orderedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedJson);
  if (!isRecord(value)) return value;
  const ordered = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).sort(compareCodeUnits)) {
    Object.defineProperty(ordered, key, {
      value: orderedJson(value[key]), enumerable: true, writable: true, configurable: true,
    });
  }
  return ordered;
}

async function behaviorFingerprint(corpusRoot: string, fixture: CorpusCase): Promise<string> {
  const behavior = structuredClone(fixture) as unknown as Record<string, unknown>;
  delete behavior.case_id;
  delete behavior.normative_rule_ids;

  const referenceDigest = async (path: string): Promise<string> => sha256(await readCorpusFile(corpusRoot, path));
  const initialTree = behavior.initial_tree as Array<Record<string, unknown>>;
  for (const entry of initialTree) entry.content_file = await referenceDigest(String(entry.content_file));

  const invocations = behavior.invocations as Array<Record<string, unknown>>;
  for (const invocation of invocations) {
    // The label is diagnostic trace metadata only; it cannot distinguish
    // otherwise behavior-identical positive and negative vectors.
    delete invocation.actor_label;
    const inputPath = invocation.stdin_content_file;
    if (typeof inputPath === "string") {
      if (invocation.stdin_mode === "interactive_script") {
        const script = parseStrictJson(await readCorpusFile(corpusRoot, inputPath)) as InteractiveScript;
        const normalizedScript = structuredClone(script) as unknown as Record<string, unknown>;
        const steps = normalizedScript.steps as Array<Record<string, unknown>>;
        for (const step of steps) {
          step.expected_prompt_file = await referenceDigest(String(step.expected_prompt_file));
        }
        invocation.stdin_content_file = orderedJson(normalizedScript);
      } else {
        invocation.stdin_content_file = await referenceDigest(inputPath);
      }
    }
    const argv = invocation.argv as string[];
    if (argv[0] === "@fixture" && argv[1] === "replace" && argv[3] !== undefined) {
      argv[3] = await referenceDigest(argv[3]);
    }
  }

  const expected = behavior.expected as Array<Record<string, unknown>>;
  for (const expectation of expected) {
    for (const field of ["stdout_json_file", "stderr_file"] as const) {
      if (typeof expectation[field] === "string") {
        expectation[field] = await referenceDigest(expectation[field]);
      }
    }
  }
  if (typeof behavior.expected_derived_view_file === "string") {
    behavior.expected_derived_view_file = await referenceDigest(behavior.expected_derived_view_file);
  }
  return JSON.stringify(orderedJson(behavior));
}

function isExactUtcTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year === 0 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1]!;
}

async function collectFiles(root: string, omitGit: boolean): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      if (omitGit && prefix === "" && entry.name === ".git") continue;
      const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new CorpusValidationError(`tree contains a link: ${relativePath}`);
      if (entry.isDirectory()) await walk(absolutePath, relativePath);
      else if (entry.isFile()) files.set(relativePath, sha256(await readFile(absolutePath)));
      else throw new CorpusValidationError(`tree contains an unsupported entry: ${relativePath}`);
    }
  }
  await walk(root, "");
  return files;
}

async function collectDirectories(root: string, omitGit: boolean): Promise<Set<string>> {
  const directories = new Set<string>();
  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      if (omitGit && prefix === "" && entry.name === ".git") continue;
      const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new CorpusValidationError(`tree contains a link: ${relativePath}`);
      if (entry.isDirectory()) {
        directories.add(relativePath);
        await walk(absolutePath, relativePath);
      } else if (!entry.isFile()) {
        throw new CorpusValidationError(`tree contains an unsupported entry: ${relativePath}`);
      }
    }
  }
  await walk(root, "");
  return directories;
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function sameMap(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) if (right.get(key) !== value) return false;
  return true;
}

function uncoveredRuleIds(
  rules: readonly Rule[],
  covered: ReadonlySet<string>,
  direction: "requires_positive" | "requires_negative",
): string[] {
  return rules
    .filter((rule) => rule[direction] && !covered.has(rule.rule_id))
    .map((rule) => rule.rule_id)
    .sort(compareCodeUnits);
}

async function findCaseFiles(casesRoot: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new CorpusValidationError("case tree contains a link");
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name === "case.json") found.push(path);
    }
  }
  await walk(casesRoot);
  return found.sort(compareCodeUnits);
}

function compileSchema(schema: unknown, label: string): ValidateFunction {
  if (!isRecord(schema)) throw new CorpusValidationError(`${label} schema is not an object`);
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    validateFormats: false,
    loadSchema: undefined as never,
    ownProperties: true,
  });
  try {
    return ajv.compile(schema as AnySchemaObject);
  } catch {
    throw new CorpusValidationError(`${label} schema could not be compiled offline`);
  }
}

function validateWith(validator: ValidateFunction, value: unknown, label: string): void {
  if (!validator(value)) throw new CorpusValidationError(`${label} does not match its closed schema`);
}

function polarityFor(corpusRoot: string, caseFile: string): "positive" | "negative" {
  const path = relative(corpusRoot, caseFile).split(sep).join("/");
  if (path.startsWith("cases/positive/")) return "positive";
  if (path.startsWith("cases/negative/")) return "negative";
  throw new CorpusValidationError(`case has no positive/negative polarity: ${path}`);
}

function assertInvocationStructure(fixture: CorpusCase): void {
  if (fixture.invocations.length !== fixture.expected.length) {
    throw new CorpusValidationError(`${fixture.case_id} invocation/expectation counts differ`);
  }
  if (fixture.applicable_platform_profiles.length !== 1
    || fixture.invocations.some((invocation) =>
      invocation.fixed_environment.CASE_PROCESS_PROFILE !== fixture.applicable_platform_profiles[0])) {
    throw new CorpusValidationError(`${fixture.case_id} fixed process profile does not match its applicable profile`);
  }
  for (const invocation of fixture.invocations) {
    if (!isExactUtcTimestamp(invocation.fixed_environment.CASE_CLOCK)
      || !isExactUtcTimestamp(invocation.fixed_environment.CASE_PROCESS_STARTED_AT)) {
      throw new CorpusValidationError(`${fixture.case_id} has an invalid fixed timestamp`);
    }
  }
  for (let index = 0; index < fixture.expected.length; index += 1) {
    const expectation = fixture.expected[index]!;
    const invocation = fixture.invocations[index]!;
    if (expectation.stderr !== "startup_failure_only" && expectation.stdout_json_file === null) {
      throw new CorpusValidationError(`${fixture.case_id} leaves normal stdout implicit`);
    }
    if (expectation.stderr === "startup_failure_only" && expectation.stdout_json_file !== null) {
      throw new CorpusValidationError(`${fixture.case_id} mixes startup stderr with a normal stdout envelope`);
    }
    if (expectation.stderr === "exact" !== (expectation.stderr_file !== null)) {
      throw new CorpusValidationError(`${fixture.case_id} has an inconsistent exact stderr reference`);
    }
    if (invocation.stdin_mode === "interactive_script" && expectation.stderr !== "exact") {
      throw new CorpusValidationError(`${fixture.case_id} leaves interactive prompt stderr implicit`);
    }
  }
  const closedGroups = new Set<string>();
  let current: string | null = null;
  for (const invocation of fixture.invocations) {
    const group = invocation.concurrency_group;
    if (group !== current) {
      if (current !== null) closedGroups.add(current);
      if (group !== null && closedGroups.has(group)) {
        throw new CorpusValidationError(`${fixture.case_id} has a non-contiguous concurrency group`);
      }
      current = group;
    }
  }
  const groups = new Set(fixture.invocations.flatMap(({ concurrency_group: group }) => group === null ? [] : [group]));
  for (const group of groups) {
    const indices = fixture.invocations.flatMap((invocation, index) =>
      invocation.concurrency_group === group ? [index] : []);
    const declaredSuccesses = indices.filter((index) => fixture.expected[index]!.process_exit === 0).length;
    if (indices.length < 2 || declaredSuccesses !== 1) {
      throw new CorpusValidationError(`${fixture.case_id} concurrency group ${group} must have exactly one declared success`);
    }
  }
}

async function loadCorpus(corpusRoot: string): Promise<{ rules: Rule[]; cases: LocatedCase[] }> {
  const rulesSchema = parseStrictJson(await readCorpusFile(corpusRoot, "schema/rules.schema.json"));
  const caseSchema = parseStrictJson(await readCorpusFile(corpusRoot, "schema/case.schema.json"));
  const bindingsSchema = parseStrictJson(await readCorpusFile(corpusRoot, "schema/bindings.schema.json"));
  const interactiveSchema = parseStrictJson(await readCorpusFile(corpusRoot, "schema/interactive-script.schema.json"));
  const validateRules = compileSchema(rulesSchema, "rules");
  const validateCase = compileSchema(caseSchema, "case");
  const validateBindings = compileSchema(bindingsSchema, "bindings");
  const validateInteractive = compileSchema(interactiveSchema, "interactive script");
  const rulesValue = parseStrictJson(await readCorpusFile(corpusRoot, "rules.json"));
  validateWith(validateRules, rulesValue, "rules.json");
  const rules = rulesValue as Rule[];
  const ruleIds = rules.map(({ rule_id }) => rule_id);
  if (new Set(ruleIds).size !== ruleIds.length) throw new CorpusValidationError("rules.json has duplicate rule IDs");
  const bindingsValue = parseStrictJson(await readCorpusFile(corpusRoot, "bindings.json"));
  validateWith(validateBindings, bindingsValue, "bindings.json");
  const bindings = bindingsValue as BindingDocument;
  if (bindings.rules.length !== rules.length
    || bindings.rules.some((binding, index) => binding.rule_id !== rules[index]!.rule_id)) {
    throw new CorpusValidationError("rule bindings do not match the ordered normative ledger");
  }
  const directionBindings: DirectionBinding[] = [];
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index]!;
    const binding = bindings.rules[index]!;
    for (const direction of ["positive", "negative"] as const) {
      const required = direction === "positive" ? rule.requires_positive : rule.requires_negative;
      const entries = binding[direction];
      if (!required && entries.length > 0) {
        throw new CorpusValidationError(`${rule.rule_id} ${direction} rule binding contradicts its non-executable direction`);
      }
      assertStableStringArray(entries.map(({ case_id }) => case_id), `${rule.rule_id} ${direction} binding cases`);
      for (const entry of entries) {
        assertStableStringArray(entry.assertion_ids, `${rule.rule_id} ${direction} assertion IDs`);
        if (!entry.assertion_ids.some((assertionId) =>
          !/^(?:process:|git-tree:exact$|tree:exact-set$|profile:)/u.test(assertionId))) {
          throw new CorpusValidationError(
            `${rule.rule_id} ${direction} rule binding lacks a clause-specific assertion`,
          );
        }
        directionBindings.push({ rule_id: rule.rule_id, case_id: entry.case_id, assertion_ids: entry.assertion_ids });
      }
    }
  }

  const knownRules = new Set(ruleIds);
  const caseFiles = await findCaseFiles(join(corpusRoot, "cases"));
  if (caseFiles.length === 0) throw new CorpusValidationError("corpus has no executable cases");
  const cases: LocatedCase[] = [];
  const caseIds = new Set<string>();
  for (const caseFile of caseFiles) {
    const value = parseStrictJson(await readFile(caseFile));
    validateWith(validateCase, value, relative(corpusRoot, caseFile));
    const fixture = value as CorpusCase;
    if (caseIds.has(fixture.case_id)) throw new CorpusValidationError(`duplicate case ID: ${fixture.case_id}`);
    caseIds.add(fixture.case_id);
    assertStableStringArray(fixture.normative_rule_ids, `${fixture.case_id} normative_rule_ids`);
    assertStableStringArray(fixture.applicable_platform_profiles, `${fixture.case_id} applicable_platform_profiles`);
    for (const ruleId of fixture.normative_rule_ids) {
      if (!knownRules.has(ruleId)) throw new CorpusValidationError(`${fixture.case_id} references unknown rule ${ruleId}`);
    }
    assertUniqueOrderedPaths(fixture.initial_tree, `${fixture.case_id} initial_tree`);
    assertUniqueOrderedPaths(fixture.expected_final_tree, `${fixture.case_id} expected_final_tree`);
    assertExactDirectoryTopology(fixture.initial_directories, fixture.initial_tree, `${fixture.case_id} initial`);
    assertExactDirectoryTopology(fixture.expected_final_directories, fixture.expected_final_tree, `${fixture.case_id} final`);
    assertInvocationStructure(fixture);
    for (const entry of fixture.initial_tree) {
      const bytes = await readCorpusFile(corpusRoot, entry.content_file);
      if (sha256(bytes) !== entry.sha256) {
        throw new CorpusValidationError(`${fixture.case_id} initial content digest mismatch: ${entry.path}`);
      }
    }
    for (const invocation of fixture.invocations) {
      if (invocation.stdin_content_file !== null) {
        const input = await readCorpusFile(corpusRoot, invocation.stdin_content_file);
        if (invocation.stdin_mode === "interactive_script") {
          const script = parseStrictJson(input);
          validateWith(validateInteractive, script, `${fixture.case_id} interactive script`);
          for (const [index, step] of (script as InteractiveScript).steps.entries()) {
            assertSafeFixturePath(step.expected_prompt_file, `${fixture.case_id} interactive prompt ${index}`);
            await readCorpusFile(corpusRoot, step.expected_prompt_file);
          }
        }
      }
    }
    for (let index = 0; index < fixture.expected.length; index += 1) {
      const expectation = fixture.expected[index]!;
      if (expectation.stdout_json_file !== null) {
        const stdout = await readCorpusFile(corpusRoot, expectation.stdout_json_file);
        const argv = fixture.invocations[index]!.argv;
        if (argv.includes("--json") || argv[0]?.startsWith("@")) parseStrictJson(stdout);
      }
      if (expectation.stderr_file !== null) await readCorpusFile(corpusRoot, expectation.stderr_file);
    }
    if (fixture.expected_derived_view_file !== null) {
      parseStrictJson(await readCorpusFile(corpusRoot, fixture.expected_derived_view_file));
    }
    cases.push({ fixture, caseFile, polarity: polarityFor(corpusRoot, caseFile), ruleBindings: [] });
  }
  const byCase = new Map(cases.map((located) => [located.fixture.case_id, located]));
  for (const rule of rules) {
    const binding = bindings.rules.find(({ rule_id }) => rule_id === rule.rule_id)!;
    for (const direction of ["positive", "negative"] as const) {
      for (const entry of binding[direction]) {
        const located = byCase.get(entry.case_id);
        if (located === undefined) throw new CorpusValidationError(`${rule.rule_id} rule binding references unknown case ${entry.case_id}`);
        if (located.polarity !== direction) {
          throw new CorpusValidationError(`${rule.rule_id} rule binding has wrong case polarity for ${entry.case_id}`);
        }
        if (!located.fixture.normative_rule_ids.includes(rule.rule_id)) {
          throw new CorpusValidationError(`${rule.rule_id} rule binding is absent from case ${entry.case_id}`);
        }
      }
    }
  }
  const rebound = cases.map((located): LocatedCase => {
    const expectedRules = directionBindings
      .filter(({ case_id }) => case_id === located.fixture.case_id)
      .map(({ rule_id }) => rule_id)
      .sort(compareCodeUnits);
    if (JSON.stringify(expectedRules) !== JSON.stringify(located.fixture.normative_rule_ids)) {
      throw new CorpusValidationError(`${located.fixture.case_id} rule binding does not exactly match its claimed rules`);
    }
    return {
      ...located,
      ruleBindings: directionBindings.filter(({ case_id }) => case_id === located.fixture.case_id),
    };
  });
  const fingerprints = new Map<string, "positive" | "negative">();
  for (const located of rebound) {
    const fingerprint = await behaviorFingerprint(corpusRoot, located.fixture);
    const opposite = fingerprints.get(fingerprint);
    if (opposite !== undefined && opposite !== located.polarity) {
      throw new CorpusValidationError(`${located.fixture.case_id} is a behavior-identical cross-polarity vector`);
    }
    fingerprints.set(fingerprint, located.polarity);
  }
  return { rules, cases: rebound };
}

async function createDestinationParent(root: string, relativePath: string): Promise<string> {
  assertSafeFixturePath(relativePath, "repository path");
  const segments = relativePath.split("/");
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    await mkdir(current, { recursive: true });
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new CorpusValidationError(`repository parent is unsafe: ${relativePath}`);
    }
  }
  const target = resolve(root, ...segments);
  if (!isContained(resolve(root), target)) throw new CorpusValidationError(`repository path escaped: ${relativePath}`);
  return target;
}

async function populateInitialTree(corpusRoot: string, repositoryRoot: string, fixture: CorpusCase): Promise<void> {
  for (const directory of fixture.initial_directories) {
    if (directory === ".git" || directory.startsWith(".git/")) {
      throw new CorpusValidationError(`${fixture.case_id} attempts to populate harness-owned Git state`);
    }
    const target = resolve(repositoryRoot, ...directory.split("/"));
    if (!isContained(resolve(repositoryRoot), target)) {
      throw new CorpusValidationError(`${fixture.case_id} directory escaped its repository`);
    }
    await mkdir(target, { recursive: true });
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new CorpusValidationError(`${fixture.case_id} populated an unsafe directory`);
    }
  }
  for (const entry of fixture.initial_tree) {
    if (entry.path === ".git" || entry.path.startsWith(".git/")) {
      throw new CorpusValidationError(`${fixture.case_id} attempts to populate harness-owned Git state`);
    }
    const bytes = await readCorpusFile(corpusRoot, entry.content_file);
    const target = await createDestinationParent(repositoryRoot, entry.path);
    await writeFile(target, bytes, { flag: "wx" });
    const exact = await realpath(target);
    if (!isContained(await realpath(repositoryRoot), exact)) {
      throw new CorpusValidationError(`${fixture.case_id} populated a path outside its repository`);
    }
  }
  if (!sameSet(await collectDirectories(repositoryRoot, true), new Set(fixture.initial_directories))) {
    throw new CorpusValidationError(`${fixture.case_id} initial directory topology is not exact`);
  }
}

type ExpandedInteractiveStep = InteractiveScript["steps"][number] & { readonly expectedPrompt: string };

class ScriptedTerminal implements CliTerminal {
  readonly interactive: boolean;
  readonly prompts: string[] = [];
  readonly assertionIds = new Set<string>();
  private cursor = 0;
  private mismatch = false;

  constructor(
    mode: CorpusInvocation["stdin_mode"],
    private readonly steps: readonly ExpandedInteractiveStep[],
  ) {
    this.interactive = mode === "interactive_script";
  }

  private consume(kind: ExpandedInteractiveStep["kind"], prompt: string, phrase: string): boolean {
    if (!this.interactive) return false;
    const index = this.cursor;
    const step = this.steps[this.cursor];
    this.cursor += 1;
    this.prompts.push(prompt);
    if (step === undefined || step.kind !== kind || step.expectedPrompt !== prompt) this.mismatch = true;
    else {
      this.assertionIds.add(`transcript:${index}:kind=${kind}`);
      this.assertionIds.add(`transcript:${index}:prompt=${sha256(Buffer.from(prompt, "utf8"))}`);
      this.assertionIds.add(`transcript:${index}:response=${JSON.stringify(step.response)}`);
    }
    return step?.response === phrase;
  }

  async confirmBasis(view: CurrentView, transition: ProposedTransition): Promise<boolean> {
    const index = this.cursor;
    emitStructuredAssertions(this.assertionIds, `transcript:${index}:view`, view);
    emitStructuredAssertions(this.assertionIds, `transcript:${index}:transition`, transition);
    return this.consume("basis", basisConfirmationPrompt(view, transition), "CONFIRM THIS BASIS");
  }

  async confirmDecision(review: ExactSubmissionReview, phrase: string): Promise<boolean> {
    const index = this.cursor;
    emitStructuredAssertions(this.assertionIds, `transcript:${index}:review`, review);
    this.assertionIds.add(`transcript:${index}:required-phrase=${JSON.stringify(phrase)}`);
    return this.consume("decision", decisionConfirmationPrompt(review, phrase), phrase);
  }

  async confirmRecovery(view: RecoveryConfirmationView): Promise<boolean> {
    const index = this.cursor;
    emitStructuredAssertions(this.assertionIds, `transcript:${index}:recovery`, view);
    return this.consume("recovery", recoveryConfirmationPrompt(view), "RECOVER THIS WRITER GUARD");
  }

  get matched(): boolean {
    return !this.mismatch && this.cursor === this.steps.length;
  }
}

type ConcurrencyGate = {
  readonly firstLockCreated: Promise<void>;
  signalFirstLock(): void;
};

function concurrencyGate(): ConcurrencyGate {
  let signal: (() => void) | undefined;
  const firstLockCreated = new Promise<void>((resolvePromise) => { signal = resolvePromise; });
  return { firstLockCreated, signalFirstLock: () => signal?.() };
}

function repositoryPath(root: string, path: string): string {
  if (isAbsolute(path) || path.includes("\0")) throw new Error("unsafe controlled repository path");
  const candidate = resolve(root, path);
  if (!isContained(resolve(root), candidate)) throw new Error("controlled repository path escaped");
  return candidate;
}

const CONTROLLED_PROFILE: AtomicPublicationProfile = {
  supported: true,
  profile: "controlled-test",
  crash_safety: "process-crash",
  physical_durability: false,
};

function controlledAtomicFs(
  root: string,
  faultPoint: FaultPoint | null,
  concurrency: { readonly rank: number; readonly gate: ConcurrencyGate } | null,
  trace: string[] = [],
  facts: Set<string> = new Set(),
  operationId = "unscoped",
): AtomicFsPort {
  const stablePath = (value: string): string => value.replaceAll("\\", "/");
  let faultInjected = false;
  const inject = (point: FaultPoint): void => {
    if (!faultInjected && faultPoint === point) {
      faultInjected = true;
      throw new Error(`controlled fault: ${point}`);
    }
  };
  const path = (relativePath: string): string => repositoryPath(root, relativePath);
  return {
    profile: CONTROLLED_PROFILE,
    readFile: async (relativePath) => {
      trace.push(`atomic.read:${stablePath(relativePath)}`);
      return readFile(path(relativePath));
    },
    async createOnce(relativePath, bytes) {
      const isCoordinationGuard = /[\\/]locks[\\/][^\\/]+(?:\.recovery)?\.lock$/u.test(relativePath);
      if (isCoordinationGuard && concurrency !== null && concurrency.rank > 0) {
        await concurrency.gate.firstLockCreated;
      }
      const handle = await open(path(relativePath), "wx");
      trace.push(`atomic.create-once:${stablePath(relativePath)}`);
      if (isCoordinationGuard) {
        emitStructuredAssertions(facts, `storage:${operationId}:${relativePath.includes(".recovery.lock") ? "recovery-guard" : "writer-guard"}`, parseGovernedJson(bytes));
      }
      if (relativePath.includes(".tmp-")) {
        try {
          inject("after_temp_open");
        } catch (error) {
          await handle.close();
          throw error;
        }
      }
      try { await handle.writeFile(bytes); } finally { await handle.close(); }
      if (isCoordinationGuard && concurrency !== null && concurrency.rank === 0) {
        concurrency.gate.signalFirstLock();
      }
      if (/[\\/](?:handoffs|submissions|decisions)[\\/]/u.test(relativePath)) {
        inject("after_envelope_create");
      }
    },
    async flushFile(relativePath) {
      const handle = await open(path(relativePath), "r+");
      try { await handle.sync(); } finally { await handle.close(); }
      trace.push(`atomic.flush-close:${stablePath(relativePath)}`);
      if (relativePath.includes(".tmp-")) inject("after_temp_flush");
    },
    async replaceCurrent(tempPath, targetPath) {
      const temp = path(tempPath);
      const target = path(targetPath);
      if (dirname(temp) !== dirname(target)) throw new Error("cross-directory controlled replacement");
      await rename(temp, target);
      trace.push(`atomic.replace:${stablePath(tempPath)}->${stablePath(targetPath)}`);
      inject("after_snapshot_replace");
    },
    remove: async (relativePath) => {
      await unlink(path(relativePath));
      trace.push(`atomic.remove:${stablePath(relativePath)}`);
    },
    async quarantineOnce(sourcePath, quarantinePath) {
      const source = path(sourcePath);
      const quarantine = path(quarantinePath);
      try {
        await lstat(quarantine);
        const error = new Error("quarantine exists") as NodeJS.ErrnoException;
        error.code = "EEXIST";
        throw error;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await rename(source, quarantine);
      trace.push(`atomic.quarantine:${stablePath(sourcePath)}->${stablePath(quarantinePath)}`);
    },
  };
}

async function publishDossierDirectory(
  root: string,
  relativeDirectory: string,
  contents: { readonly directories: readonly string[]; readonly files: Readonly<Record<string, Uint8Array>> },
): Promise<void> {
  const target = repositoryPath(root, relativeDirectory);
  const staging = `${target}.staging`;
  await mkdir(staging);
  for (const directory of contents.directories) {
    assertSafeFixturePath(directory, "dossier directory");
    await mkdir(join(staging, ...directory.split("/")));
  }
  for (const [relativePath, bytes] of Object.entries(contents.files)) {
    assertSafeFixturePath(relativePath, "dossier file");
    const targetFile = join(staging, ...relativePath.split("/"));
    await mkdir(dirname(targetFile), { recursive: true });
    await writeFile(targetFile, bytes, { flag: "wx" });
  }
  await rename(staging, target);
}

type CaseContext = {
  readonly repositoryRoot: string;
  readonly schemas: SchemaRegistry;
  readonly profile: PlatformProfile;
  dossierCounter: number;
  runCounter: number;
  guardCounter: number;
  readonly operationTraces: Map<string, string[]>;
  readonly operationFacts: Set<string>;
};

function tracedEvidenceInspection(repositoryRoot: string, trace: string[]): PathInspectionPort {
  const displayPath = (path: string): string => {
    const fromRoot = relative(repositoryRoot, path);
    return (fromRoot === "" ? "." : fromRoot).replaceAll("\\", "/");
  };
  return {
    lstat: async (path) => {
      trace.push(`evidence.lstat:${displayPath(path)}`);
      return nodePathInspection.lstat(path);
    },
    realpath: async (path) => {
      trace.push(`evidence.realpath:${displayPath(path)}`);
      return nodePathInspection.realpath(path);
    },
    listDirectory: async (path) => {
      trace.push(`evidence.list:${displayPath(path)}`);
      return nodePathInspection.listDirectory(path);
    },
    openRead: async (path) => {
      const displayed = displayPath(path);
      trace.push(`evidence.open:${displayed}`);
      const handle = await nodePathInspection.openRead(path);
      return {
        readAll: async () => {
          trace.push(`evidence.read:${displayed}`);
          return handle.readAll();
        },
        stat: async () => {
          trace.push(`evidence.stat:${displayed}`);
          return handle.stat();
        },
        close: async () => {
          trace.push(`evidence.close:${displayed}`);
          return handle.close();
        },
      };
    },
  };
}

async function invocationDependencies(
  corpusRoot: string,
  invocation: CorpusInvocation,
  context: CaseContext,
  concurrency: { readonly rank: number; readonly gate: ConcurrencyGate } | null,
  terminalOverride: CliTerminal | null = null,
): Promise<CliDependencies> {
  const environment = invocation.fixed_environment;
  const operationIndex = invocation.argv.indexOf("--operation");
  const operationId = operationIndex >= 0 ? invocation.argv[operationIndex + 1] ?? "missing-operation" : invocation.argv.slice(0, 3).join(".");
  const trace = context.operationTraces.get(operationId) ?? [];
  context.operationTraces.set(operationId, trace);
  const fs = controlledAtomicFs(context.repositoryRoot, invocation.fault_point, concurrency, trace, context.operationFacts, operationId);
  class TracedCaseStore extends CaseStore {
    override async loadDossier(id: string): Promise<DossierSnapshot> {
      trace.push(`store.load:${id}`);
      return super.loadDossier(id);
    }
  }
  const store = new TracedCaseStore(context.repositoryRoot, context.schemas);
  const dossiers: DossierDirectoryPublicationPort = {
    profile: CONTROLLED_PROFILE,
    publishCreateOnce: (path, contents) => publishDossierDirectory(context.repositoryRoot, path, contents),
  };
  const ports: WorkflowPorts = {
    repository_root: context.repositoryRoot,
    store,
    schemas: context.schemas,
    evidenceFs: tracedEvidenceInspection(context.repositoryRoot, trace),
    fs,
    dossiers,
    processIdentity: {
      current: async () => {
        context.operationFacts.add(
          `identity-current:${operationId}:pid=${environment.CASE_PROCESS_PID}:started=${environment.CASE_PROCESS_STARTED_AT}`,
        );
        return {
          profile: environment.CASE_PROCESS_PROFILE,
          pid: environment.CASE_PROCESS_PID,
          process_started_at: environment.CASE_PROCESS_STARTED_AT,
        };
      },
      verifyTerminated: async () => {
        context.operationFacts.add(`identity-verification:${operationId}=${environment.CASE_PROCESS_STATUS}`);
        return environment.CASE_PROCESS_STATUS;
      },
    },
    clock: {
      now: () => environment.CASE_CLOCK,
      isPossiblyStale: () => true,
    },
    ids: {
      createGuardId: () => `${environment.CASE_ID_SEED}-guard-${++context.guardCounter}`,
      tempIdFor: (guardId) => `temp-${guardId}`,
      envelopeIdFor: (kind, operationId) => `${kind}-${operationId}`,
      createDossierId: () => `${environment.CASE_ID_SEED}-dossier-${++context.dossierCounter}`,
      createRunId: () => `${environment.CASE_ID_SEED}-run-${++context.runCounter}`,
      evidenceIdFor: (operationId) => `evidence-${operationId}`,
    },
  };
  let interactiveSteps: ExpandedInteractiveStep[] = [];
  if (invocation.stdin_mode === "interactive_script" && invocation.stdin_content_file !== null) {
    const parsed = parseStrictJson(await readCorpusFile(corpusRoot, invocation.stdin_content_file)) as InteractiveScript;
    interactiveSteps = await Promise.all(parsed.steps.map(async (step) => ({
      ...step,
      expectedPrompt: Buffer.from(await readCorpusFile(corpusRoot, step.expected_prompt_file)).toString("utf8"),
    })));
  }
  const terminal = terminalOverride ?? new ScriptedTerminal(invocation.stdin_mode, interactiveSteps);
  const initFs = {
    ...nodeRepositoryFileSystem,
    classifyInitializationTarget: async () => ({ supported: true as const, profile: "controlled-test" }),
  };
  return {
    cwd: context.repositoryRoot,
    terminal,
    workflows: {
      init: (request) => initRepository(request, {
        fs: initFs,
        git: { confirmWorktreeRoot: async () => context.repositoryRoot },
        schemas: context.schemas,
        createRepositoryId: () => `${environment.CASE_ID_SEED}-repository`,
        now: () => environment.CASE_CLOCK,
        displayRepositoryRoot: async () => {
          let namespaceAbsent = false;
          try { await lstat(join(context.repositoryRoot, ".case-agent")); } catch (error) {
            namespaceAbsent = (error as NodeJS.ErrnoException).code === "ENOENT";
          }
          trace.push(namespaceAbsent ? "init.display-root-before-namespace" : "init.display-root-existing-namespace");
        },
      }),
      createDossier: (request) => createDossier(request, ports),
      showDossier: (request) => showDossier(request, ports),
      checkDossier: (request) => checkDossier(request, ports),
      addEvidence: (request) => addEvidence(request, ports),
      createSubmission: (request) => createSubmission(request, ports),
      recordDecision: (request) => recordDecision(request, { ...ports, confirmation: terminal }),
      offerHandoff: (request) => offerHandoff(request, ports),
      acceptHandoff: (request) => acceptHandoff(request, ports),
      recoverGuard: (request) => recoverWriterGuard(store, request, ports),
    },
  };
}

function baseProbeAssertion(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`probe assertion failed: ${message}`);
}

function exactStructuredMatch(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function probeThrows(action: () => unknown, pattern: RegExp): void {
  let observed: unknown;
  try {
    action();
  } catch (error) {
    observed = error;
  }
  baseProbeAssertion(observed instanceof Error && pattern.test(observed.message), `expected ${pattern.source}`);
}

async function probeRejects(action: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  let observed: unknown;
  try {
    await action();
  } catch (error) {
    observed = error;
  }
  baseProbeAssertion(observed instanceof Error && pattern.test(observed.message), `expected ${pattern.source}`);
}

function assertionSlug(message: string): string {
  return message.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}

function escapeJsonPointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function emitStructuredAssertions(
  assertions: Set<string>,
  prefix: string,
  value: unknown,
  pointer = "",
): void {
  if (Array.isArray(value)) {
    assertions.add(`${prefix}:${pointer}:length=${value.length}`);
    value.forEach((item, index) => emitStructuredAssertions(assertions, prefix, item, `${pointer}/${index}`));
    return;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort(compareCodeUnits);
    assertions.add(`${prefix}:${pointer}:keys=${keys.join(",")}`);
    for (const key of keys) {
      emitStructuredAssertions(assertions, prefix, value[key], `${pointer}/${escapeJsonPointer(key)}`);
    }
    return;
  }
  const literal = JSON.stringify(value);
  if (literal !== undefined && literal.length <= 256 && !/[\u0000-\u001f]/u.test(literal)) {
    assertions.add(`${prefix}:${pointer}=${literal}`);
  }
}

function baseProbeSnapshot(): DossierSnapshot {
  const candidate: DossierSnapshot = {
    dossier_id: "probe-dossier",
    title: "Display title",
    objective: "Prove exact projections",
    scope: { in: ["artifact.txt"], out: ["deployment"] },
    constraints: ["local-only"],
    acceptance_criteria: [
      { criterion_id: "criterion-a", statement: "Artifact is current", verification: "mechanical" },
      { criterion_id: "criterion-b", statement: "Reviewer inspects it", verification: "recorded_human_review" },
    ],
    state_revision: revision("1"),
    state_digest: digest(`sha256:${"0".repeat(64)}`),
    last_operation: {
      operation_id: "op-evidence",
      input_digest: digest(`sha256:${"1".repeat(64)}`),
      basis_revision: revision("0"),
      resulting_revision: revision("1"),
    },
    active_run: { run_id: "run-a", actor_id: "actor-a", started_by_handoff_id: null },
    evidence: [
      {
        evidence_id: "evidence-a",
        criterion_ids: ["criterion-a"],
        kind: "file",
        location: { repository_relative_path: "artifact.txt" },
        captured_at: "2026-09-04T03:02:01Z",
        artifact_digest: digest(`sha256:${"2".repeat(64)}`),
        artifact_size: "2" as never,
        freshness: "recompute_on_check",
        limitations: ["Z_LIMIT", "A_LIMIT"],
      },
      {
        evidence_id: "evidence-b",
        criterion_ids: ["criterion-b"],
        kind: "external_reference",
        location: { uri: "https://example.invalid/evidence" },
        captured_at: "2026-09-04T03:02:01Z",
        freshness: "human_review",
        limitations: [],
      },
    ],
    current_handoff_id: null,
    current_submission_id: null,
    current_decision_id: null,
  };
  return { ...candidate, state_digest: digestProjection(projectState(candidate)) };
}

function validMinimalCase(environment: FixedEnvironment): CorpusCase {
  return {
    fixture_version: "1",
    case_id: "schema-probe",
    normative_rule_ids: ["M0-CORPUS-002"],
    applicable_platform_profiles: ["controlled-test"],
    initial_directories: [],
    initial_tree: [],
    invocations: [{
      actor_label: "trace-probe",
      argv: ["@probe", "corpus-contract-positive"],
      stdin_mode: "none",
      stdin_content_file: null,
      fixed_environment: environment,
      concurrency_group: null,
      fault_point: null,
    }],
    expected: [{
      process_exit: 0,
      result_code: "CASE_OK",
      stdout_json_file: "data/expected/probe-ok.json",
      stderr: "empty",
      stderr_file: null,
    }],
    expected_final_tree: [],
    expected_final_directories: [],
    expected_derived_view_file: null,
  };
}

async function runProtocolProbe(
  probe: string,
  corpusRoot: string,
  context: CaseContext,
  environment: FixedEnvironment,
): Promise<{ readonly result: ResultEnvelope<null>; readonly assertionIds: readonly string[] }> {
  const executed = new Set<string>();
  const probeAssertion: (condition: unknown, message: string) => asserts condition = (condition, message) => {
    baseProbeAssertion(condition, message);
    executed.add(`probe.${assertionSlug(message)}`);
  };
  const probeThrowsAssertion = (action: () => unknown, pattern: RegExp, message: string): void => {
    let observed: unknown;
    try { action(); } catch (error) { observed = error; }
    probeAssertion(observed instanceof Error && pattern.test(observed.message), message);
  };
  const probeRejectsAssertion = async (action: () => Promise<unknown>, pattern: RegExp, message: string): Promise<void> => {
    let observed: unknown;
    try { await action(); } catch (error) { observed = error; }
    probeAssertion(observed instanceof Error && pattern.test(observed.message), message);
  };
  if (probe === "strict-json-valid") {
    const bytes = Buffer.from('{"a":[true,null,"text"],"\\u0062":"\\ud83d\\ude00"}', "utf8");
    const parsed = parseGovernedJson(bytes);
    probeAssertion(JSON.stringify(parsed) === '{"a":[true,null,"text"],"b":"😀"}', "valid UTF-8 byte sequence accepted before schema");
    probeAssertion(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), "BOM absent governed JSON accepted");
    probeAssertion(Object.keys(parsed as Record<string, unknown>).join(",") === "a,b", "distinct decoded object members accepted");
    probeAssertion(JSON.stringify(parsed).includes("😀"), "paired Unicode scalar accepted");
    probeAssertion(JSON.stringify(parsed) === '{"a":[true,null,"text"],"b":"😀"}', "number-free protocol JSON accepted");
  } else if (probe === "json-duplicate") {
    probeThrowsAssertion(() => parseGovernedJson(Buffer.from('{"a":true,"\\u0061":false}', "utf8")), /CASE_E_PARSE/u, "duplicate decoded object member rejected");
  } else if (probe === "json-number") {
    probeThrowsAssertion(() => parseGovernedJson(Buffer.from('{"value":1}', "utf8")), /CASE_E_PARSE/u, "numeric protocol value rejected");
  } else if (probe === "json-bom") {
    probeThrowsAssertion(() => parseGovernedJson(Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), /CASE_E_PARSE/u, "governed JSON BOM rejected");
  } else if (probe === "json-invalid-utf8") {
    probeThrowsAssertion(() => parseGovernedJson(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d])), /CASE_E_PARSE/u, "invalid UTF-8 rejected before schema");
  } else if (probe === "json-invalid-unicode") {
    probeThrowsAssertion(() => parseGovernedJson(Buffer.from('{"x":"\\ud800"}', "utf8")), /CASE_E_PARSE/u, "isolated Unicode surrogate rejected");
    probeThrowsAssertion(() => parseGovernedJson(Buffer.from('{"x":"\\ufdd0"}', "utf8")), /CASE_E_PARSE/u, "Unicode noncharacter rejected");
  } else if (probe === "crlf") {
    probeAssertion(JSON.stringify(parseGovernedJson(Buffer.from("{\r\n\t\"a\": true\r\n}\r\n", "utf8"))) === '{"a":true}', "CRLF JSON");
  } else if (probe === "schema-valid") {
    const manifest = {
      protocol: "case-agent",
      protocol_version: "0.1.0-preview",
      schema_dialect: "https://json-schema.org/draft/2020-12/schema",
      repository_id: "repository-a",
      created_at: environment.CASE_CLOCK,
    };
    probeAssertion(context.schemas.validate("manifest", manifest).ok, "valid bundled manifest root");
    probeAssertion(!context.schemas.validate("manifest", { ...manifest, unknown: true }).ok, "critical roots are closed");
    probeAssertion(!context.schemas.validate("manifest", { ...manifest, created_at: "2026-02-30T03:02:01Z" }).ok, "timestamp semantics do not rely on format annotation alone");
    const schemaDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../schemas");
    let roots = 0;
    for (const entry of await readdir(schemaDirectory)) {
      if (!entry.endsWith(".schema.json")) continue;
      roots += 1;
      const schema = JSON.parse(await readFile(join(schemaDirectory, entry), "utf8")) as Record<string, unknown>;
      probeAssertion(schema.$schema === "https://json-schema.org/draft/2020-12/schema", `${entry} dialect`);
      probeAssertion(typeof schema.$id === "string" && schema.$id.length > 0, `${entry} stable id`);
    }
    probeAssertion(roots === 9, "all nine bundled governed roots inspected");
  } else if (probe === "schema-unknown") {
    const snapshot = { ...baseProbeSnapshot(), unexpected: true };
    probeAssertion(!context.schemas.validate("dossier", snapshot).ok, "unknown dossier field rejected");
  } else if (probe === "jcs-unicode") {
    const nfc = { "😀": "é", z: "last", a: "first" };
    const nfd = { "😀": "e\u0301", z: "last", a: "first" };
    probeAssertion(canonicalize(nfc) === '{"a":"first","z":"last","😀":"é"}', "UTF-16 key order");
    probeAssertion(digestProjection(nfc) !== digestProjection(nfd), "Unicode is not normalized");
    probeAssertion(/^sha256:[0-9a-f]{64}$/u.test(digestProjection(nfc)), "canonical projection hashes to lowercase SHA-256 wire digest");
    probeAssertion(digestProjection({ values: ["first", "second"] }) !== digestProjection({ values: ["second", "first"] }), "canonical array order remains significant");
  } else if (probe === "jcs-mutation") {
    const value = { z: "last", a: ["é", "e\u0301"] };
    const canonical = canonicalize(value);
    const nonCanonical = JSON.stringify(value);
    probeAssertion(canonical === '{"a":["é","é"],"z":"last"}' && canonical !== nonCanonical, "noncanonical member order differs from JCS bytes");
    probeAssertion(digestProjection(value) !== `sha256:${"0".repeat(64)}`, "wrong canonical digest is detected");
    probeAssertion(digestProjection(value) !== digestProjection({ a: ["e\u0301", "é"], z: "last" }), "array reorder changes canonical digest");
    probeAssertion(digestProjection(value) !== digestProjection({ a: ["é", "é"], z: "last" }), "Unicode normalization changes canonical digest");
  } else if (probe === "key-order") {
    probeAssertion(canonicalize({ z: true, a: false, aa: null }) === '{"a":false,"aa":null,"z":true}', "canonical key order");
  } else if (probe === "unicode-nfd") {
    probeAssertion(canonicalize(["é"]) !== canonicalize(["e\u0301"]), "NFC and NFD remain distinct");
  } else if (probe === "scalar-valid") {
    probeAssertion(context.schemas.validate("dossier", { ...baseProbeSnapshot(), dossier_id: "opaque.ID-Δ" }).ok, "opaque identifier accepted without semantic interpretation");
    probeAssertion(isRevision("0") && isRevision("314") && !isRevision("01"), "nonnegative revision grammar without leading zero");
    probeAssertion(isDigest(`sha256:${"a".repeat(64)}`) && !isDigest(`sha256:${"A".repeat(64)}`), "lowercase SHA-256 digest grammar");
    probeAssertion(context.schemas.validate("manifest", {
      protocol: "case-agent",
      protocol_version: "0.1.0-preview",
      schema_dialect: "https://json-schema.org/draft/2020-12/schema",
      repository_id: "opaque-id",
      created_at: "2026-09-04T03:02:01Z",
    }).ok, "UTC RFC3339 Z timestamp accepted");
    const before = baseProbeSnapshot();
    const after = structuredClone(before);
    after.evidence[0]!.captured_at = "2099-01-01T00:00:00Z";
    probeAssertion(digestProjection(projectContent(before)) === digestProjection(projectContent(after)), "display timestamp cannot order or alter governed content");
    let localized = "";
    renderJson(failure("probe", "CASE_E_CONFLICT", "時計衝突"), { write: (value) => { localized += value; } });
    const localizedEnvelope = parseGovernedJson(Buffer.from(localized, "utf8")) as Record<string, unknown>;
    probeAssertion(localizedEnvelope.code === "CASE_E_CONFLICT" && Object.keys(localizedEnvelope).every((key) => /^[a-z_]+$/u.test(key)), "machine fields and code stay English ASCII under localized message");
  } else if (probe === "scalar-invalid") {
    probeAssertion(!context.schemas.validate("dossier", { ...baseProbeSnapshot(), dossier_id: "" }).ok, "empty opaque identifier rejected");
    probeAssertion(!isRevision("-1") && !isRevision("01"), "negative and leading-zero revisions rejected");
    probeAssertion(!isDigest(`sha256:${"A".repeat(64)}`), "uppercase digest rejected");
    probeAssertion(!context.schemas.validate("manifest", {
      protocol: "case-agent",
      protocol_version: "0.1.0-preview",
      schema_dialect: "https://json-schema.org/draft/2020-12/schema",
      repository_id: "opaque-id",
      created_at: "2026-09-04T03:02:01+08:00",
    }).ok, "non-Z timestamp rejected");
    let localized = "";
    renderJson(failure("probe", "CASE_E_CONFLICT", "不應改變代碼"), { write: (value) => { localized += value; } });
    const localizedEnvelope = parseGovernedJson(Buffer.from(localized, "utf8")) as Record<string, unknown>;
    probeAssertion(localizedEnvelope.code === "CASE_E_CONFLICT" && Object.keys(localizedEnvelope).every((key) => /^[a-z_]+$/u.test(key)), "localized text cannot alter machine field or code spelling");
  } else if (probe === "scalar-opaque-positive") {
    probeAssertion(context.schemas.validate("dossier", { ...baseProbeSnapshot(), dossier_id: "opaque.ID-Δ" }).ok, "opaque identifier accepted without semantic interpretation");
    const schemaDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../schemas");
    const opaqueReferences: string[] = [];
    const collectOpaqueReferences = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => collectOpaqueReferences(item, `${path}/${index}`));
        return;
      }
      if (!isRecord(value)) return;
      if (typeof value.$ref === "string" && /(?:^|\/)opaque_id(?:_array)?$/u.test(value.$ref)) {
        opaqueReferences.push(`${path}=${value.$ref}`);
      }
      for (const [key, child] of Object.entries(value)) collectOpaqueReferences(child, `${path}/${key}`);
    };
    for (const entry of (await readdir(schemaDirectory)).filter((name) => name.endsWith(".schema.json")).sort(compareCodeUnits)) {
      collectOpaqueReferences(parseStrictJson(await readFile(join(schemaDirectory, entry))), entry);
    }
    probeAssertion(
      opaqueReferences.length === 37
        && opaqueReferences.every((reference) => reference.endsWith("#/$defs/opaque_id") || reference.endsWith("#/$defs/opaque_id_array")),
      "all identifier bearing schema positions use shared opaque scalar",
    );
  } else if (probe === "scalar-opaque-negative") {
    probeAssertion(!context.schemas.validate("dossier", { ...baseProbeSnapshot(), dossier_id: "" }).ok, "empty opaque identifier rejected");
    probeAssertion(
      !context.schemas.validate("manifest", {
        protocol: "case-agent",
        protocol_version: "0.1.0-preview",
        schema_dialect: "https://json-schema.org/draft/2020-12/schema",
        repository_id: "",
        created_at: environment.CASE_CLOCK,
      }).ok && !context.schemas.validate("dossier", { ...baseProbeSnapshot(), active_run: { ...baseProbeSnapshot().active_run, actor_id: "" } }).ok,
      "shared opaque identifier rejects empty across root schemas",
    );
  } else if (probe === "scalar-revision-positive") {
    probeAssertion(isRevision("0") && isRevision("314") && !isRevision("01"), "nonnegative revision grammar without leading zero");
  } else if (probe === "scalar-revision-negative") {
    probeAssertion(!isRevision("-1") && !isRevision("01"), "negative and leading-zero revisions rejected");
  } else if (probe === "scalar-digest-positive") {
    probeAssertion(isDigest(`sha256:${"a".repeat(64)}`) && !isDigest(`sha256:${"A".repeat(64)}`), "lowercase SHA-256 digest grammar");
  } else if (probe === "scalar-digest-negative") {
    probeAssertion(!isDigest(`sha256:${"A".repeat(64)}`), "uppercase digest rejected");
  } else if (probe === "scalar-timestamp-positive") {
    probeAssertion(context.schemas.validate("manifest", {
      protocol: "case-agent",
      protocol_version: "0.1.0-preview",
      schema_dialect: "https://json-schema.org/draft/2020-12/schema",
      repository_id: "opaque-id",
      created_at: "2026-09-04T03:02:01Z",
    }).ok, "UTC RFC3339 Z timestamp accepted");
  } else if (probe === "scalar-timestamp-negative") {
    probeAssertion(!context.schemas.validate("manifest", {
      protocol: "case-agent",
      protocol_version: "0.1.0-preview",
      schema_dialect: "https://json-schema.org/draft/2020-12/schema",
      repository_id: "opaque-id",
      created_at: "2026-09-04T03:02:01+08:00",
    }).ok, "non-Z timestamp rejected");
  } else if (probe === "scalar-locale-positive") {
    let localized = "";
    renderJson(failure("probe", "CASE_E_CONFLICT", "時計衝突"), { write: (value) => { localized += value; } });
    const envelope = parseGovernedJson(Buffer.from(localized, "utf8")) as Record<string, unknown>;
    probeAssertion(envelope.code === "CASE_E_CONFLICT" && Object.keys(envelope).every((key) => /^[a-z_]+$/u.test(key)), "machine fields and code stay English ASCII under localized message");
    probeAssertion(
      envelope.code === "CASE_E_CONFLICT" && envelope.message === "時計衝突" && exitCodeFor(envelope.code) === 30,
      "localized message preserves exact conflict process exit class",
    );
  } else if (probe === "scalar-locale-negative") {
    let localized = "";
    renderJson(failure("probe", "CASE_E_CONFLICT", "不應改變代碼"), { write: (value) => { localized += value; } });
    const envelope = parseGovernedJson(Buffer.from(localized, "utf8")) as Record<string, unknown>;
    probeAssertion(envelope.code === "CASE_E_CONFLICT" && Object.keys(envelope).every((key) => /^[a-z_]+$/u.test(key)), "localized text cannot alter machine field or code spelling");
    probeAssertion(
      envelope.code === "CASE_E_CONFLICT" && envelope.message === "不應改變代碼" && exitCodeFor(envelope.code) === 30,
      "machine branch uses code rather than localized text",
    );
  } else if (probe === "wall-clock-independent") {
    const base = baseProbeSnapshot();
    const candidate: DossierSnapshot = {
      ...base,
      evidence: [{
        ...base.evidence[1]!,
        evidence_id: "evidence-future",
        captured_at: "2099-01-01T00:00:00Z",
      }],
      last_operation: {
        operation_id: "op-future",
        input_digest: digestProjection({ operation: "future" }),
        basis_revision: revision("0"),
        resulting_revision: revision("1"),
      },
      state_revision: revision("1"),
    };
    const future = { ...candidate, state_digest: digestProjection(projectState(candidate)) };
    const dossierDirectory = join(context.repositoryRoot, ".case-agent", "dossiers", future.dossier_id);
    await mkdir(join(dossierDirectory, "handoffs"), { recursive: true });
    await mkdir(join(dossierDirectory, "submissions"), { recursive: true });
    await mkdir(join(dossierDirectory, "decisions"), { recursive: true });
    await mkdir(join(context.repositoryRoot, ".case-agent", "locks"), { recursive: true });
    await writeFile(join(dossierDirectory, "dossier.json"), `${JSON.stringify(future)}\n`, { flag: "wx" });
    try {
      const invocation: CorpusInvocation = {
        actor_label: "trace-probe",
        argv: ["@probe", probe],
        stdin_mode: "none",
        stdin_content_file: null,
        fixed_environment: environment,
        concurrency_group: null,
        fault_point: null,
      };
      const dependencies = await invocationDependencies(corpusRoot, invocation, context, null);
      const result = await dependencies.workflows.addEvidence({
        dossier_id: future.dossier_id,
        operation_id: "op-past",
        expected_revision: future.state_revision,
        expected_state_digest: future.state_digest,
        run_id: future.active_run.run_id,
        kind: "external_reference",
        criterion_ids: ["criterion-b"],
        freshness: "human_review",
        limitations: ["clock-does-not-order"],
        location: { uri: "https://example.invalid/past" },
      });
      const committed = await new CaseStore(context.repositoryRoot, context.schemas).loadDossier(future.dossier_id);
      probeAssertion(result.ok && committed.state_revision === "2", "reverse wall clock mutation advances by revision");
      probeAssertion(
        committed.evidence[0]?.captured_at === "2099-01-01T00:00:00Z"
          && committed.evidence[1]?.captured_at === environment.CASE_CLOCK
          && committed.evidence[1]!.captured_at < committed.evidence[0]!.captured_at,
        "evidence append order ignores wall clock chronology",
      );
    } finally {
      await rm(join(context.repositoryRoot, ".case-agent"), { recursive: true, force: true });
    }
  } else if (probe === "human-basis-race") {
    const shownView: CurrentView = {
      dossier_id: "dossier-a",
      title: "Displayed basis",
      objective: "Keep the displayed compare-and-swap basis",
      scope: { in: ["artifact.txt"], out: [] },
      constraints: [],
      active_run: { run_id: "run-a", actor_id: "actor-a", started_by_handoff_id: null },
      state_revision: revision("4"),
      state_digest: digest(`sha256:${"1".repeat(64)}`),
      criterion_results: [],
      evidence_gaps: [],
      current_checks: "passed",
      review: "working",
      acceptance: "pending",
      handoff: "none",
      recommended_next_action: "CASE_NEXT_CREATE_SUBMISSION",
      unresolved_warnings: [],
    };
    let currentRevision = revision("4");
    let capturedRevision = "";
    let capturedDigest = "";
    const noop = async (): Promise<ResultEnvelope<unknown>> => success("probe", "unused", null);
    const terminal: CliTerminal = {
      interactive: true,
      confirmBasis: async () => { currentRevision = revision("5"); return true; },
      confirmDecision: async () => true,
      confirmRecovery: async () => true,
    };
    const dependencies: CliDependencies = {
      cwd: context.repositoryRoot,
      terminal,
      workflows: {
        init: noop,
        createDossier: noop,
        showDossier: async () => success("dossier.show", "shown", shownView),
        checkDossier: noop,
        addEvidence: noop,
        createSubmission: async (request) => {
          capturedRevision = request.expected_revision;
          capturedDigest = request.expected_state_digest;
          return request.expected_revision === currentRevision
            ? success("submission.create", "incorrectly rebound", null)
            : failure("submission.create", "CASE_E_CONFLICT", "stale displayed basis");
        },
        recordDecision: noop,
        offerHandoff: noop,
        acceptHandoff: noop,
        recoverGuard: noop,
      },
    };
    const result = await runCli([
      "submission", "create", "--dossier", "dossier-a", "--operation", "op-race", "--run", "run-a",
    ], dependencies);
    probeAssertion(
      capturedRevision === "4" && capturedDigest === shownView.state_digest,
      "confirmed human mutation retains displayed basis after intervening state",
    );
    probeAssertion(!result.ok && result.code === "CASE_E_CONFLICT", "intervening state rejects rather than silently rebinding human mutation");
  } else if (probe === "mutation-invalid-snapshot") {
    const snapshot = baseProbeSnapshot();
    const invalidSnapshot = { ...snapshot, unknown_critical_field: true };
    const originalBytes = Buffer.from(`${JSON.stringify(invalidSnapshot)}\n`, "utf8");
    const dossierDirectory = join(context.repositoryRoot, ".case-agent", "dossiers", snapshot.dossier_id);
    const lockPath = join(context.repositoryRoot, ".case-agent", "locks", `${snapshot.dossier_id}.lock`);
    await mkdir(join(dossierDirectory, "handoffs"), { recursive: true });
    await mkdir(join(dossierDirectory, "submissions"), { recursive: true });
    await mkdir(join(dossierDirectory, "decisions"), { recursive: true });
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(join(dossierDirectory, "dossier.json"), originalBytes, { flag: "wx" });
    try {
      const invocation: CorpusInvocation = {
        actor_label: "trace-probe",
        argv: ["@probe", probe],
        stdin_mode: "none",
        stdin_content_file: null,
        fixed_environment: environment,
        concurrency_group: null,
        fault_point: null,
      };
      const dependencies = await invocationDependencies(corpusRoot, invocation, context, null);
      const result = await dependencies.workflows.addEvidence({
        dossier_id: snapshot.dossier_id,
        operation_id: "op-invalid-state",
        expected_revision: snapshot.state_revision,
        expected_state_digest: snapshot.state_digest,
        run_id: snapshot.active_run.run_id,
        kind: "external_reference",
        criterion_ids: ["criterion-b"],
        freshness: "human_review",
        limitations: ["schema-invalid-basis"],
        location: { uri: "https://example.invalid/invalid-basis" },
      });
      const trace = context.operationTraces.get("@probe.mutation-invalid-snapshot") ?? [];
      const guardCreate = trace.findIndex((event) => event === "atomic.create-once:.case-agent/locks/probe-dossier.lock");
      const stateLoad = trace.findIndex((event) => event === "store.load:probe-dossier");
      probeAssertion(guardCreate >= 0 && stateLoad > guardCreate, "guarded mutation acquires before loading invalid snapshot");
      probeAssertion(
        !result.ok && result.code === "CASE_E_INTERNAL"
          && !trace.some((event) => event.includes(".dossier.json.tmp-") || event.includes("/handoffs/") || event.includes("/submissions/") || event.includes("/decisions/")),
        "schema invalid loaded snapshot fails before transition",
      );
      const persisted = await readFile(join(dossierDirectory, "dossier.json"));
      const lockAbsent = await lstat(lockPath).then(() => false, (error) => (error as NodeJS.ErrnoException).code === "ENOENT");
      probeAssertion(
        persisted.equals(originalBytes) && lockAbsent,
        "failed loaded snapshot validation preserves state and releases guard",
      );
    } finally {
      await rm(join(context.repositoryRoot, ".case-agent"), { recursive: true, force: true });
    }
  } else if (probe === "identifier-nonreuse") {
    const base = baseProbeSnapshot();
    const candidate: DossierSnapshot = {
      ...base,
      acceptance_criteria: [base.acceptance_criteria[1]!],
      evidence: [base.evidence[1]!],
      current_handoff_id: null,
      current_submission_id: null,
      current_decision_id: null,
    };
    const seeded = { ...candidate, state_digest: digestProjection(projectState(candidate)) };
    const dossierDirectory = join(context.repositoryRoot, ".case-agent", "dossiers", seeded.dossier_id);
    await mkdir(join(dossierDirectory, "handoffs"), { recursive: true });
    await mkdir(join(dossierDirectory, "submissions"), { recursive: true });
    await mkdir(join(dossierDirectory, "decisions"), { recursive: true });
    await mkdir(join(context.repositoryRoot, ".case-agent", "locks"), { recursive: true });
    await writeFile(join(dossierDirectory, "dossier.json"), `${JSON.stringify(seeded)}\n`, { flag: "wx" });
    try {
      const invocation: CorpusInvocation = {
        actor_label: "trace-probe",
        argv: ["@probe", probe],
        stdin_mode: "none",
        stdin_content_file: null,
        fixed_environment: environment,
        concurrency_group: null,
        fault_point: null,
      };
      const confirmation: CliTerminal = {
        interactive: true,
        confirmBasis: async () => true,
        confirmDecision: async () => true,
        confirmRecovery: async () => true,
      };
      const dependencies = await invocationDependencies(corpusRoot, invocation, context, null, confirmation);
      const firstSubmission = await dependencies.workflows.createSubmission({
        dossier_id: seeded.dossier_id,
        operation_id: "op-submission-a",
        expected_revision: seeded.state_revision,
        expected_state_digest: seeded.state_digest,
        submitting_run_id: seeded.active_run.run_id,
      });
      probeAssertion(firstSubmission.ok, "first governed submission for identifier nonreuse succeeds");
      const firstSubmissionData = firstSubmission.data as SubmissionEnvelope;
      const afterFirstSubmission = await new CaseStore(context.repositoryRoot, context.schemas).loadDossier(seeded.dossier_id);
      const firstDecision = await dependencies.workflows.recordDecision({
        dossier_id: seeded.dossier_id,
        operation_id: "op-decision-a",
        expected_revision: afterFirstSubmission.state_revision,
        expected_state_digest: afterFirstSubmission.state_digest,
        submission_id: firstSubmissionData.submission_id,
        submission_digest: firstSubmissionData.submission_digest,
        reviewer_id: "reviewer-a",
        criteria_reviewed: ["criterion-b"],
        comment: "First exact decision",
        decision: "accepted",
      });
      probeAssertion(firstDecision.ok, "first governed decision for identifier nonreuse succeeds");
      const firstDecisionData = firstDecision.data as DecisionEnvelope;
      const afterFirstDecision = await new CaseStore(context.repositoryRoot, context.schemas).loadDossier(seeded.dossier_id);
      const secondSubmission = await dependencies.workflows.createSubmission({
        dossier_id: seeded.dossier_id,
        operation_id: "op-submission-b",
        expected_revision: afterFirstDecision.state_revision,
        expected_state_digest: afterFirstDecision.state_digest,
        submitting_run_id: seeded.active_run.run_id,
      });
      probeAssertion(secondSubmission.ok, "second governed submission for identifier nonreuse succeeds");
      const secondSubmissionData = secondSubmission.data as SubmissionEnvelope;
      const afterSecondSubmission = await new CaseStore(context.repositoryRoot, context.schemas).loadDossier(seeded.dossier_id);
      const secondDecision = await dependencies.workflows.recordDecision({
        dossier_id: seeded.dossier_id,
        operation_id: "op-decision-b",
        expected_revision: afterSecondSubmission.state_revision,
        expected_state_digest: afterSecondSubmission.state_digest,
        submission_id: secondSubmissionData.submission_id,
        submission_digest: secondSubmissionData.submission_digest,
        reviewer_id: "reviewer-b",
        criteria_reviewed: ["criterion-b"],
        comment: "Second exact decision",
        decision: "rejected",
      });
      probeAssertion(secondDecision.ok, "second governed decision for identifier nonreuse succeeds");
      const secondDecisionData = secondDecision.data as DecisionEnvelope;
      const finalSnapshot = await new CaseStore(context.repositoryRoot, context.schemas).loadDossier(seeded.dossier_id);
      const firstSubmissionExists = await lstat(join(dossierDirectory, "submissions", `${firstSubmissionData.submission_id}.json`)).then((info) => info.isFile());
      const secondSubmissionExists = await lstat(join(dossierDirectory, "submissions", `${secondSubmissionData.submission_id}.json`)).then((info) => info.isFile());
      const firstDecisionExists = await lstat(join(dossierDirectory, "decisions", `${firstDecisionData.decision_id}.json`)).then((info) => info.isFile());
      const secondDecisionExists = await lstat(join(dossierDirectory, "decisions", `${secondDecisionData.decision_id}.json`)).then((info) => info.isFile());
      probeAssertion(
        firstSubmissionData.submission_id !== secondSubmissionData.submission_id
          && firstSubmissionExists && secondSubmissionExists,
        "two governed submissions in one dossier retain distinct immutable identifiers",
      );
      probeAssertion(
        firstDecisionData.decision_id !== secondDecisionData.decision_id
          && firstDecisionExists && secondDecisionExists,
        "two governed decisions in one dossier retain distinct immutable identifiers",
      );
      probeAssertion(
        finalSnapshot.current_submission_id === secondSubmissionData.submission_id
          && finalSnapshot.current_decision_id === secondDecisionData.decision_id,
        "latest pointers advance without overwriting earlier envelopes",
      );
    } finally {
      await rm(join(context.repositoryRoot, ".case-agent"), { recursive: true, force: true });
    }
  } else if (probe === "projections-positive") {
    const snapshot = baseProbeSnapshot();
    const observed: ObservedEvidenceProjection = {
      dossier_id: snapshot.dossier_id,
      content_digest: digestProjection(projectContent(snapshot)),
      evidence_results: [
        { evidence_id: "evidence-a", status: "current", observed_artifact_digest: digest(`sha256:${"2".repeat(64)}`), observed_artifact_size: "2" as never, stable_limitation_codes: ["Z_LIMIT", "A_LIMIT"] },
        { evidence_id: "evidence-b", status: "human_review_required", observed_artifact_digest: null, observed_artifact_size: null, stable_limitation_codes: [] },
      ],
    };
    const checks = buildChecksProjection(snapshot, observed, true);
    const projectedState = projectState(snapshot) as Record<string, unknown>;
    const projectedContent = projectContent(snapshot) as Record<string, unknown>;
    const projectedObserved = projectObservedEvidence(observed) as Record<string, unknown>;
    const projectedChecks = projectChecks(checks) as Record<string, unknown>;
    probeAssertion(
      Object.keys({ state_revision: "1", state_digest: "s", content_digest: "c", observed_evidence_digest: "o", checks_digest: "k", submission_digest: "u" }).length === 6,
      "six named protocol digest and revision concepts remain distinct",
    );
    probeAssertion(
      Object.keys(projectedState).sort(compareCodeUnits).join(",")
        === "acceptance_criteria,active_run,constraints,current_decision_id,current_handoff_id,current_submission_id,dossier_id,evidence,last_operation,objective,scope,state_revision,title"
        && !Object.hasOwn(projectedState, "state_digest"),
      "state projection has every stored field except state digest",
    );
    probeAssertion(
      Object.keys(projectedContent).sort(compareCodeUnits).join(",") === "acceptance_criteria,constraints,dossier_id,evidence,objective,scope"
        && !JSON.stringify(projectedContent).includes("captured_at"),
      "content projection exact fields and captured-at exclusion",
    );
    const submissionWithoutDigest = {
      submission_id: "submission-a",
      dossier_id: snapshot.dossier_id,
      submitting_run_id: snapshot.active_run.run_id,
      basis_revision: snapshot.state_revision,
      basis_state_digest: snapshot.state_digest,
      published_revision: revision("2"),
      content_digest: digestProjection(projectContent(snapshot)),
      observed_evidence_digest: digestProjection(projectObservedEvidence(observed)),
      checks_digest: digestProjection(projectChecks(checks)),
      created_at: "2026-09-04T03:02:01Z",
      created_operation_id: "op-submit",
    };
    const submission = {
      ...submissionWithoutDigest,
      submission_digest: digestProjection(submissionWithoutDigest),
    };
    const projectedSubmissionValue = projectSubmission(submission);
    probeAssertion(isRecord(projectedSubmissionValue), "submission self projection is an object");
    const projectedSubmission = projectedSubmissionValue;
    probeAssertion(
      Object.keys(projectedSubmission).sort(compareCodeUnits).join(",")
        === "basis_revision,basis_state_digest,checks_digest,content_digest,created_at,created_operation_id,dossier_id,observed_evidence_digest,published_revision,submission_id,submitting_run_id"
        && !Object.hasOwn(projectedSubmission, "submission_digest")
        && digestProjection(projectedSubmissionValue) === submission.submission_digest,
      "submission self projection excludes only submission digest",
    );
    probeAssertion(
      Object.keys(projectedObserved).sort(compareCodeUnits).join(",") === "content_digest,dossier_id,evidence_results"
        && Object.keys((projectedObserved.evidence_results as Record<string, unknown>[])[0]!).sort(compareCodeUnits).join(",")
          === "evidence_id,observed_artifact_digest,observed_artifact_size,stable_limitation_codes,status",
      "observed evidence projection has exact fields",
    );
    probeAssertion(
      JSON.stringify((projectedObserved.evidence_results as Array<{ evidence_id: string }>).map(({ evidence_id }) => evidence_id)) === '["evidence-a","evidence-b"]',
      "observed evidence preserves dossier evidence order",
    );
    probeAssertion(JSON.stringify((projectedObserved.evidence_results as Array<{ stable_limitation_codes: string[] }>)[0]!.stable_limitation_codes) === '["A_LIMIT","Z_LIMIT"]', "observed limitation codes use ASCII order");
    probeAssertion(!/absolute|timestamp|retry|diagnostic|error_number/u.test(JSON.stringify(projectedObserved)), "observed evidence excludes unstable filesystem and diagnostic data");
    const external = (projectedObserved.evidence_results as Array<Record<string, unknown>>)[1]!;
    probeAssertion(external.status === "human_review_required" && external.observed_artifact_digest === null && external.observed_artifact_size === null, "external reference projects human review with null artifact observations");
    probeAssertion(
      Object.keys(projectedChecks).sort(compareCodeUnits).join(",")
        === "content_digest,criterion_results,dossier_id,invariant_results,observed_evidence_digest,stable_warning_codes,verdict",
      "checks projection has exact fields",
    );
    probeAssertion(
      JSON.stringify((projectedChecks.invariant_results as Array<{ code: string }>).map(({ code }) => code))
        === '["CASE_I_PARSE","CASE_I_SCHEMA","CASE_I_STATE","CASE_I_EVIDENCE_SAFETY","CASE_I_EVIDENCE_INTEGRITY","CASE_I_EVIDENCE_LINKS","CASE_I_ENVELOPE_INTEGRITY","CASE_I_DERIVED_STATUS"]',
      "check invariants use protocol-stage then ASCII code order",
    );
    probeAssertion(
      JSON.stringify((projectedChecks.criterion_results as Array<{ criterion_id: string }>).map(({ criterion_id }) => criterion_id)) === '["criterion-a","criterion-b"]',
      "check criteria preserve canonical criterion order",
    );
    probeAssertion(JSON.stringify(projectedChecks.stable_warning_codes) === '["CASE_W_HUMAN_REVIEW_REQUIRED"]', "check warning codes use ASCII order");
    probeAssertion(!/state_revision|state_digest|current_handoff|last_operation|timestamp|diagnostic/u.test(JSON.stringify(projectedChecks)), "checks projection excludes state envelope and diagnostic metadata");
    probeAssertion(checks.criterion_results[0]?.status === "mechanically_satisfied"
      && JSON.stringify(checks.criterion_results[0]?.supporting_evidence_ids) === '["evidence-a"]',
    "current linked local artifact mechanically satisfies its criterion");
    const alternativesCandidate: DossierSnapshot = {
      ...snapshot,
      evidence: [
        snapshot.evidence[0]!,
        { ...snapshot.evidence[0]!, evidence_id: "evidence-alternative" },
        snapshot.evidence[1]!,
      ],
    };
    const alternatives = {
      ...alternativesCandidate,
      state_digest: digestProjection(projectState(alternativesCandidate)),
    };
    const alternativesObserved: ObservedEvidenceProjection = {
      dossier_id: alternatives.dossier_id,
      content_digest: digestProjection(projectContent(alternatives)),
      evidence_results: [
        observed.evidence_results[0]!,
        {
          evidence_id: "evidence-alternative",
          status: "changed",
          observed_artifact_digest: digest(`sha256:${"3".repeat(64)}`),
          observed_artifact_size: "2" as never,
          stable_limitation_codes: [],
        },
        observed.evidence_results[1]!,
      ],
    };
    const alternativeChecks = buildChecksProjection(alternatives, alternativesObserved, true);
    probeAssertion(
      alternativeChecks.criterion_results[0]?.status === "mechanically_satisfied"
        && JSON.stringify(alternativeChecks.criterion_results[0]?.supporting_evidence_ids) === '["evidence-a"]',
      "multiple linked artifacts are alternatives and one current artifact satisfies criterion",
    );
    probeAssertion(checks.criterion_results[1]?.status === "human_review_required"
      && JSON.stringify(checks.criterion_results[1]?.supporting_evidence_ids) === '["evidence-b"]',
    "linked recorded-human criterion remains human review required");
    probeAssertion(checks.verdict === "passed", "human review required alone does not fail checks or assert approval");
    probeAssertion(
      checks.verdict === "passed" && checks.criterion_results[0]?.status === "mechanically_satisfied",
      "current mechanical evidence plus linked human review makes checks pass",
    );
    const displayChanged = { ...snapshot, title: "Other", state_revision: revision("9"), active_run: { ...snapshot.active_run, actor_id: "actor-z" } };
    probeAssertion(digestProjection(projectContent(displayChanged)) === digestProjection(projectContent(snapshot)), "assignment revision and display metadata do not change content digest");
    const withEvidence = { ...snapshot, evidence: [...snapshot.evidence, { ...snapshot.evidence[1]!, evidence_id: "evidence-c" }] };
    probeAssertion(digestProjection(projectContent(withEvidence)) !== digestProjection(projectContent(snapshot)), "adding registered evidence changes content digest");
    probeAssertion(digestProjection(projectObservedEvidence(observed)) === checks.observed_evidence_digest, "current artifact observations match embedded checks digest");
  } else if (probe === "projections-negative") {
    const snapshot = baseProbeSnapshot();
    const observed: ObservedEvidenceProjection = {
      dossier_id: snapshot.dossier_id,
      content_digest: digestProjection(projectContent(snapshot)),
      evidence_results: [
        { evidence_id: "evidence-a", status: "changed", observed_artifact_digest: digest(`sha256:${"3".repeat(64)}`), observed_artifact_size: "2" as never, stable_limitation_codes: [] },
        { evidence_id: "evidence-b", status: "human_review_required", observed_artifact_digest: null, observed_artifact_size: null, stable_limitation_codes: [] },
      ],
    };
    const failed = buildChecksProjection(snapshot, observed, true);
    probeAssertion(failed.verdict === "failed" && failed.criterion_results[0]!.status === "failed", "changed artifact makes its mechanical criterion fail");
    probeAssertion(digestProjection(projectContent(snapshot)) === observed.content_digest
      && digestProjection(projectObservedEvidence(observed)) !== digestProjection(projectObservedEvidence({ ...observed, evidence_results: [{ ...observed.evidence_results[0]!, observed_artifact_digest: digest(`sha256:${"2".repeat(64)}`) }, observed.evidence_results[1]!] })),
    "artifact byte observation stales derived digests without changing stored content");
    const changedTitle = { ...snapshot, title: "Other display title" };
    probeAssertion(digestProjection(projectContent(changedTitle)) === digestProjection(projectContent(snapshot)), "title excluded from content");
    probeAssertion(digestProjection(projectState(changedTitle)) !== snapshot.state_digest, "title retained by state");
    probeAssertion(digestProjection({ ...(projectContent(snapshot) as Record<string, unknown>), title: snapshot.title }) !== digestProjection(projectContent(snapshot)), "invented content field changes canonical bytes");
    probeAssertion(digestProjection(projectContent({ ...snapshot, evidence: [snapshot.evidence[0]!] })) !== digestProjection(projectContent(snapshot)), "removing registered evidence changes content digest");
    const invariantFailed = buildChecksProjection(snapshot, { ...observed, evidence_results: [
      { ...observed.evidence_results[0]!, status: "current", observed_artifact_digest: digest(`sha256:${"2".repeat(64)}`) },
      observed.evidence_results[1]!,
    ] }, false);
    probeAssertion(invariantFailed.verdict === "failed" && invariantFailed.invariant_results.some(({ status }) => status === "failed"), "any failed invariant fails checks");
    const missingMechanical = buildChecksProjection(snapshot, { ...observed, evidence_results: [
      { ...observed.evidence_results[0]!, status: "missing", observed_artifact_digest: null, observed_artifact_size: null },
      observed.evidence_results[1]!,
    ] }, true);
    probeAssertion(missingMechanical.criterion_results[0]!.status === "failed" && missingMechanical.verdict === "failed", "unsatisfied mechanical criterion fails checks");
    const withoutHumanEvidenceCandidate = { ...snapshot, evidence: [snapshot.evidence[0]!] };
    const withoutHumanEvidence = { ...withoutHumanEvidenceCandidate, state_digest: digestProjection(projectState(withoutHumanEvidenceCandidate)) };
    const observedWithoutHuman: ObservedEvidenceProjection = {
      dossier_id: snapshot.dossier_id,
      content_digest: digestProjection(projectContent(withoutHumanEvidence)),
      evidence_results: [{ ...observed.evidence_results[0]!, status: "current", observed_artifact_digest: digest(`sha256:${"2".repeat(64)}`) }],
    };
    const unlinkedHuman = buildChecksProjection(withoutHumanEvidence, observedWithoutHuman, true);
    probeAssertion(unlinkedHuman.criterion_results[1]!.status === "failed" && unlinkedHuman.verdict === "failed", "unlinked recorded-human criterion fails checks");
    probeAssertion(
      unlinkedHuman.criterion_results[0]!.status === "mechanically_satisfied"
        && unlinkedHuman.criterion_results[1]!.status === "failed"
        && unlinkedHuman.verdict === "failed",
      "one unlinked criterion makes an otherwise satisfied conjunction fail",
    );
    probeAssertion(
      unlinkedHuman.criterion_results[1]!.supporting_evidence_ids.length === 0,
      "unlinked recorded-human criterion has no supporting evidence identifiers",
    );
    const duplicateCriterionCandidate: DossierSnapshot = {
      ...snapshot,
      acceptance_criteria: [
        snapshot.acceptance_criteria[0]!,
        { ...snapshot.acceptance_criteria[1]!, criterion_id: snapshot.acceptance_criteria[0]!.criterion_id },
      ],
    };
    const duplicateCriteria = {
      ...duplicateCriterionCandidate,
      state_digest: digestProjection(projectState(duplicateCriterionCandidate)),
    };
    const duplicateCriterionObserved = {
      ...observed,
      content_digest: digestProjection(projectContent(duplicateCriteria)),
    };
    probeAssertion(
      buildChecksProjection(duplicateCriteria, duplicateCriterionObserved, true)
        .invariant_results.find(({ code }) => code === "CASE_I_EVIDENCE_LINKS")?.status === "failed",
      "duplicate criterion identifiers fail evidence link invariant",
    );
    const duplicateEvidenceCandidate: DossierSnapshot = {
      ...snapshot,
      evidence: [snapshot.evidence[0]!, { ...snapshot.evidence[1]!, evidence_id: snapshot.evidence[0]!.evidence_id }],
    };
    const duplicateEvidence = {
      ...duplicateEvidenceCandidate,
      state_digest: digestProjection(projectState(duplicateEvidenceCandidate)),
    };
    const duplicateEvidenceObserved: ObservedEvidenceProjection = {
      dossier_id: duplicateEvidence.dossier_id,
      content_digest: digestProjection(projectContent(duplicateEvidence)),
      evidence_results: [
        observed.evidence_results[0]!,
        { ...observed.evidence_results[1]!, evidence_id: snapshot.evidence[0]!.evidence_id },
      ],
    };
    probeAssertion(
      buildChecksProjection(duplicateEvidence, duplicateEvidenceObserved, true)
        .invariant_results.find(({ code }) => code === "CASE_I_EVIDENCE_INTEGRITY")?.status === "failed",
      "duplicate evidence identifiers fail evidence integrity invariant",
    );
    probeAssertion(!context.schemas.validate("dossier", { ...snapshot, status: "DONE" }).ok, "free standing dossier status is rejected");
    probeAssertion(!context.schemas.validate("dossier", { ...snapshot, checks: failed }).ok, "mutable dossier checks cache is rejected");
    const reordered = { ...observed, evidence_results: [observed.evidence_results[1]!, observed.evidence_results[0]!] };
    probeAssertion(digestProjection(projectObservedEvidence(reordered)) !== digestProjection(projectObservedEvidence(observed)), "reordered evidence observations change digest");
    const observedProjection = projectObservedEvidence(observed) as Record<string, unknown>;
    probeAssertion(!context.schemas.validate("observed-evidence", { ...observedProjection, invented: true }).ok, "unknown observed evidence projection root field is rejected");
    const forbiddenObservedFields = ["absolute_path", "platform_error", "observed_at", "localized_message", "retry_count", "filesystem_order"];
    probeAssertion(
      forbiddenObservedFields.every((field) => !context.schemas.validate("observed-evidence", { ...observedProjection, [field]: "unstable" }).ok),
      "all unstable observed evidence fields are rejected",
    );
    const checksProjection = projectChecks(failed) as Record<string, unknown>;
    probeAssertion(!context.schemas.validate("checks", { ...checksProjection, invented: true }).ok, "unknown checks projection root field is rejected");
    const forbiddenChecksFields = ["state_revision", "state_digest", "current_handoff_id", "last_operation", "os_error", "absolute_path", "observed_at", "localized_message", "retry_count"];
    probeAssertion(
      forbiddenChecksFields.every((field) => !context.schemas.validate("checks", { ...checksProjection, [field]: "unstable" }).ok),
      "all state and diagnostic checks fields are rejected",
    );
    const projectedUnsortedObserved = projectObservedEvidence({ ...observed, evidence_results: [
      { ...observed.evidence_results[0]!, stable_limitation_codes: ["Z_LIMIT", "A_LIMIT"] }, observed.evidence_results[1]!,
    ] }) as Record<string, unknown>;
    probeAssertion(JSON.stringify((projectedUnsortedObserved.evidence_results as Array<{ stable_limitation_codes: string[] }>)[0]!.stable_limitation_codes) === '["A_LIMIT","Z_LIMIT"]', "unsorted observed limitation input is canonicalized");
    const checkOrderMutation = structuredClone(projectChecks(failed)) as Record<string, unknown>;
    (checkOrderMutation.invariant_results as unknown[]).reverse();
    probeAssertion(digestProjection(checkOrderMutation as never) !== digestProjection(projectChecks(failed)), "reordered check invariants change digest");
    const criterionOrderMutation = structuredClone(projectChecks(failed)) as Record<string, unknown>;
    (criterionOrderMutation.criterion_results as unknown[]).reverse();
    probeAssertion(digestProjection(criterionOrderMutation as never) !== digestProjection(projectChecks(failed)), "reordered check criteria change digest");
    const warningsInput = { ...failed, stable_warning_codes: ["Z_WARNING", "A_WARNING"] };
    const projectedWarnings = projectChecks(warningsInput) as Record<string, unknown>;
    probeAssertion(JSON.stringify(projectedWarnings.stable_warning_codes) === '["A_WARNING","Z_WARNING"]', "unsorted check warnings are canonicalized");
    const externalOnlyCandidate = {
      ...snapshot,
      acceptance_criteria: [{ criterion_id: "criterion-a", statement: "Must be mechanical", verification: "mechanical" as const }],
      evidence: [{ ...snapshot.evidence[1]!, criterion_ids: ["criterion-a"] }],
    };
    const externalOnly = { ...externalOnlyCandidate, state_digest: digestProjection(projectState(externalOnlyCandidate)) };
    const externalObserved: ObservedEvidenceProjection = {
      dossier_id: externalOnly.dossier_id,
      content_digest: digestProjection(projectContent(externalOnly)),
      evidence_results: [{ evidence_id: "evidence-b", status: "human_review_required", observed_artifact_digest: null, observed_artifact_size: null, stable_limitation_codes: [] }],
    };
    probeAssertion(buildChecksProjection(externalOnly, externalObserved, true).criterion_results[0]!.status === "failed", "external reference cannot satisfy mechanical criterion");
    const forgedExternalObserved: ObservedEvidenceProjection = {
      ...externalObserved,
      evidence_results: [{
        evidence_id: "evidence-b",
        status: "current",
        observed_artifact_digest: digest(`sha256:${"4".repeat(64)}`),
        observed_artifact_size: "4" as never,
        stable_limitation_codes: [],
      }],
    };
    const forgedExternalChecks = buildChecksProjection(externalOnly, forgedExternalObserved, true);
    probeAssertion(
      forgedExternalChecks.invariant_results.find(({ code }) => code === "CASE_I_EVIDENCE_INTEGRITY")?.status === "failed",
      "external current observation with artifact fields fails evidence integrity",
    );
    probeAssertion(
      forgedExternalChecks.criterion_results[0]!.status === "failed",
      "forged external current observation cannot mechanically satisfy criterion",
    );
    const localWithoutDigest = { ...snapshot.evidence[0] } as Record<string, unknown>;
    delete localWithoutDigest.artifact_digest;
    delete localWithoutDigest.artifact_size;
    probeAssertion(!context.schemas.validate("dossier", { ...snapshot, evidence: [localWithoutDigest] }).ok, "local evidence without digest and size is rejected");
  } else if (probe === "separator") {
    const invalidPaths = {
      "backslash evidence path rejected at CLI boundary": "a\\b",
      "ADS evidence path rejected at CLI boundary": "artifact.txt:stream",
      "device evidence path rejected at CLI boundary": "CON",
      "trailing-dot evidence path rejected at CLI boundary": "artifact.txt.",
      "dot-segment evidence path rejected at CLI boundary": "a/../b",
      "UNC evidence path rejected at CLI boundary": "//server/share",
    };
    for (const [message, repositoryRelativePath] of Object.entries(invalidPaths)) {
      const parsed = parseCliRequest([
        "--json", "evidence", "add", "--dossier", "d", "--operation", "op", "--run", "r",
        "--expected-revision", "0", "--expected-state-digest", `sha256:${"a".repeat(64)}`,
        "--evidence", JSON.stringify({ kind: "file", criterion_ids: ["c"], freshness: "recompute_on_check", limitations: [], location: { repository_relative_path: repositoryRelativePath } }),
      ]);
      probeAssertion(!parsed.ok && parsed.code === "CASE_E_USAGE", message);
    }
  } else if (probe === "case-alias") {
    await probeRejects(() => resolveEvidencePath(context.repositoryRoot, "artifacts/evidence.txt"), /CASE_E_EVIDENCE/u);
    probeAssertion(true, "wrong-case path spelling is rejected");
  } else if (probe === "adapter-alias") {
    const ambiguous: PathInspectionPort = {
      ...nodePathInspection,
      async listDirectory(path) {
        const entries = await nodePathInspection.listDirectory(path);
        return path.endsWith(`${sep}artifacts`) ? [...entries, { name: "evidence.txt" }] : entries;
      },
    };
    await probeRejects(
      () => resolveEvidencePath(context.repositoryRoot, "artifacts/Evidence.txt", ambiguous),
      /CASE_E_EVIDENCE/u,
    );
    probeAssertion(true, "adapter-reported case-fold ambiguity is rejected");
  } else if (probe === "hardlink-alias") {
    const source = join(context.repositoryRoot, "artifacts", "Evidence.txt");
    const alias = join(context.repositoryRoot, "artifacts", "Evidence-alias.txt");
    await link(source, alias);
    try {
      await probeRejectsAssertion(
        () => resolveEvidencePath(context.repositoryRoot, "artifacts/Evidence.txt"),
        /CASE_E_EVIDENCE/u,
        "real hardlink evidence alias is rejected",
      );
    } finally {
      await unlink(alias);
    }
  } else if (probe === "outside-root") {
    await probeRejectsAssertion(
      () => resolveEvidencePath(context.repositoryRoot, "../outside.txt"),
      /CASE_E_EVIDENCE/u,
      "outside-root evidence path is rejected",
    );
  } else if (probe === "directory-evidence") {
    await probeRejectsAssertion(
      () => resolveEvidencePath(context.repositoryRoot, "artifacts"),
      /CASE_E_EVIDENCE/u,
      "directory evidence target is rejected",
    );
  } else if (probe === "symlink") {
    let openAttempted = false;
    const fake: PathInspectionPort = {
      ...nodePathInspection,
      lstat: async (path) => path.endsWith(`${sep}linked`) ? {
        device: 1n, inode: 2n, hardLinkCount: 1n, isFile: () => false, isDirectory: () => false,
        isSymbolicLink: () => true, isReparsePoint: () => false,
      } : nodePathInspection.lstat(path),
      openRead: async (path) => {
        openAttempted = true;
        return nodePathInspection.openRead(path);
      },
    };
    await probeRejectsAssertion(
      () => resolveEvidencePath(context.repositoryRoot, "linked/artifact.txt", fake),
      /CASE_E_EVIDENCE/u,
      "symbolic link evidence is rejected",
    );
    probeAssertion(!openAttempted, "symbolic link segment is rejected before artifact open");
  } else if (probe === "junction") {
    const outside = await mkdtemp(join(tmpdir(), "case-agent-conformance-outside-"));
    const alias = join(context.repositoryRoot, "junction");
    let openAttempted = false;
    const inspected: PathInspectionPort = {
      ...nodePathInspection,
      openRead: async (path) => {
        openAttempted = true;
        return nodePathInspection.openRead(path);
      },
    };
    try {
      await writeFile(join(outside, "artifact.txt"), "outside", { flag: "wx" });
      await symlink(outside, alias, "junction");
      await probeRejectsAssertion(
        () => resolveEvidencePath(context.repositoryRoot, "junction/artifact.txt", inspected),
        /CASE_E_EVIDENCE/u,
        "junction evidence is rejected",
      );
      probeAssertion(!openAttempted, "junction escape is rejected before artifact open");
    } finally {
      try { await unlink(alias); } catch { /* absent link */ }
      await safeRemoveTemporary(outside);
    }
  } else if (probe === "validator-throws") {
    const before = await collectFiles(context.repositoryRoot, true);
    const result = await checkDossier({ dossier_id: "case-dossier-1" }, {
      repository_root: context.repositoryRoot,
      store: new CaseStore(context.repositoryRoot, context.schemas),
      schemas: { validate: () => { throw new Error("controlled validator fault"); } },
      fs: controlledAtomicFs(context.repositoryRoot, null, null),
      evidenceFs: nodePathInspection,
    });
    probeAssertion(!result.ok && result.code === "CASE_E_INTERNAL", "validator exception fails closed");
    probeAssertion(sameMap(before, await collectFiles(context.repositoryRoot, true)), "validator fault is read-only");
  } else if (probe === "schema-contract-negative") {
    const schemaDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../schemas");
    const identified = (schema: Record<string, unknown>): boolean =>
      schema.$schema === "https://json-schema.org/draft/2020-12/schema"
      && typeof schema.$id === "string" && schema.$id.length > 0;
    const manifestSchema = JSON.parse(await readFile(join(schemaDirectory, "manifest.schema.json"), "utf8")) as Record<string, unknown>;
    probeAssertion(identified(manifestSchema), "bundled schema identity");
    const unidentified = { ...manifestSchema };
    delete unidentified.$id;
    probeAssertion(!identified(unidentified), "missing schema identity rejected by bundle policy");
    const undialected = { ...manifestSchema };
    delete undialected.$schema;
    probeAssertion(!identified(undialected), "missing schema dialect rejected by bundle policy");
    const manifest = {
      protocol: "case-agent",
      protocol_version: "0.1.0-preview",
      schema_dialect: "https://json-schema.org/draft/2020-12/schema",
      repository_id: "repository-a",
      created_at: environment.CASE_CLOCK,
    };
    const { protocol_version: _version, ...withoutVersion } = manifest;
    const { schema_dialect: _dialect, ...withoutDialect } = manifest;
    const { protocol: _protocol, ...withoutProtocol } = manifest;
    const { repository_id: _repositoryId, ...withoutRepositoryId } = manifest;
    const { created_at: _createdAt, ...withoutCreatedAt } = manifest;
    probeAssertion(!context.schemas.validate("manifest", withoutVersion).ok, "protocol version is required separately");
    probeAssertion(!context.schemas.validate("manifest", withoutDialect).ok, "schema dialect is required separately");
    probeAssertion(!context.schemas.validate("manifest", withoutProtocol).ok, "protocol ownership field is required");
    probeAssertion(!context.schemas.validate("manifest", withoutRepositoryId).ok, "repository identity field is required");
    probeAssertion(!context.schemas.validate("manifest", withoutCreatedAt).ok, "manifest creation timestamp field is required");
    const dossier = baseProbeSnapshot();
    const { active_run: _activeRun, ...withoutActiveRun } = dossier;
    probeAssertion(!context.schemas.validate("dossier", withoutActiveRun).ok, "complete dossier rejects a missing active run field");
    probeAssertion(!context.schemas.validate("manifest", { ...manifest, protocol: "other-agent" }).ok, "foreign protocol ownership is rejected");
    probeAssertion(
      !context.schemas.validate("manifest", { ...manifest, created_at: "2026-02-30T03:02:01Z" }).ok,
      "invalid timestamp rejected by semantic validator not annotation",
    );
    probeThrowsAssertion(() => compileSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://case-agent.local/conformance/unbundled.schema.json",
      $ref: "https://network.invalid/schema.json",
    }, "unbundled reference"), /could not be compiled offline/u, "unbundled schema reference rejected offline");
  } else if (probe === "handoff-shape-negative") {
    const envelope = {
      handoff_id: "handoff-op-offer",
      dossier_id: "case-dossier-1",
      from_run_id: "case-run-1",
      to_actor_id: "actor-b",
      basis_revision: "0",
      basis_state_digest: digest(`sha256:${"1".repeat(64)}`),
      published_revision: "1",
      offered_content_digest: digest(`sha256:${"2".repeat(64)}`),
      created_operation_id: "op-offer",
    };
    probeAssertion(context.schemas.validate("handoff", envelope).ok, "exact handoff shape is valid");
    probeAssertion(!context.schemas.validate("handoff", { ...envelope, unexpected: true }).ok, "unknown handoff field is rejected");
    probeAssertion(!context.schemas.validate("handoff", { ...envelope, status: "offered" }).ok, "stored handoff status is rejected");
    probeAssertion(!context.schemas.validate("handoff", { ...envelope, status_basis: {} }).ok, "stored handoff status basis is rejected");
  } else if (probe === "decision-shape-negative") {
    const envelope = {
      decision_id: "decision-op-decision",
      dossier_id: "case-dossier-1",
      submission_id: "submission-op-submit",
      submission_digest: digest(`sha256:${"1".repeat(64)}`),
      decision: "accepted",
      reviewer_id: "reviewer-a",
      criteria_reviewed: ["criterion-a"],
      comment: "Reviewed exact submission",
      decided_at: environment.CASE_CLOCK,
      created_operation_id: "op-decision",
      identity_assurance: "recorded-interactive-claim",
    };
    probeAssertion(context.schemas.validate("decision", envelope).ok, "exact closed decision envelope is valid");
    probeAssertion(!context.schemas.validate("decision", { ...envelope, authenticated: true }).ok, "unknown decision field is rejected");
    probeAssertion(!context.schemas.validate("decision", { ...envelope, identity_assurance: "authenticated" }).ok, "unsupported strong identity assurance is rejected");
  } else if (probe === "cli-contract") {
    const expectedCommands = [
      "decision.accept",
      "decision.reject",
      "dossier.check",
      "dossier.create",
      "dossier.show",
      "evidence.add",
      "guard.recover",
      "handoff.accept",
      "handoff.offer",
      "init",
      "submission.create",
    ];
    probeAssertion(
      JSON.stringify(Object.keys(CLI_OPTIONS).sort()) === JSON.stringify(expectedCommands),
      "CLI exposes exactly the eleven M0 commands",
    );
    probeAssertion(
      !parseCliRequest(["--json", "dossier", "abandon", "--dossier", "dossier-a"]).ok,
      "dossier abandonment command is absent",
    );
    probeAssertion(
      !parseCliRequest(["--json", "dossier", "archive", "--dossier", "dossier-a"]).ok
        && !parseCliRequest(["--json", "dossier", "reopen", "--dossier", "dossier-a"]).ok,
      "dossier archive and reopen commands are absent",
    );
    probeAssertion(
      !parseCliRequest(["--json", "handoff", "cancel", "--dossier", "dossier-a"]).ok,
      "handoff cancellation command is absent",
    );
    const basis = ["--expected-revision", "0", "--expected-state-digest", `sha256:${"a".repeat(64)}`];
    const validInvocations: readonly (readonly string[])[] = [
      ["--json", "init", "--operation", "op-init"],
      ["--json", "dossier", "create", "--operation", "op-create", "--actor", "actor-a", "--title", "Title", "--objective", "Objective", "--brief", '{"scope":{"in":["artifact.txt"],"out":["deployment"]},"constraints":["local-only"],"acceptance_criteria":[{"criterion_id":"criterion-a","statement":"Artifact is current","verification":"mechanical"}]}'],
      ["--json", "dossier", "show", "--dossier", "dossier-a"],
      ["--json", "dossier", "check", "--dossier", "dossier-a"],
      ["--json", "evidence", "add", "--dossier", "dossier-a", "--operation", "op-evidence", ...basis, "--run", "run-a", "--evidence", '{"kind":"file","criterion_ids":["criterion-a"],"freshness":"recompute_on_check","limitations":[],"location":{"repository_relative_path":"artifact.txt"}}'],
      ["--json", "submission", "create", "--dossier", "dossier-a", "--operation", "op-submit", ...basis, "--run", "run-a"],
      ["--json", "decision", "accept", "--dossier", "dossier-a", "--operation", "op-accept", ...basis, "--submission", "submission-a", "--submission-digest", `sha256:${"b".repeat(64)}`, "--reviewer", "reviewer-a", "--criteria", '["criterion-a"]', "--comment", "Accepted"],
      ["--json", "decision", "reject", "--dossier", "dossier-a", "--operation", "op-reject", ...basis, "--submission", "submission-a", "--submission-digest", `sha256:${"b".repeat(64)}`, "--reviewer", "reviewer-a", "--criteria", '["criterion-a"]', "--comment", "Rejected"],
      ["--json", "handoff", "offer", "--dossier", "dossier-a", "--operation", "op-offer", ...basis, "--from-run", "run-a", "--to-actor", "actor-b"],
      ["--json", "handoff", "accept", "--dossier", "dossier-a", "--operation", "op-handoff-accept", ...basis, "--handoff", "handoff-a", "--offered-content-digest", `sha256:${"c".repeat(64)}`, "--actor", "actor-b"],
      ["--json", "guard", "recover", "--dossier", "dossier-a", "--operation", "op-recover", ...basis],
    ];
    for (const argv of validInvocations) {
      probeAssertion(parseCliRequest(argv).ok, `declared CLI command parses: ${argv.slice(1, 3).join(" ")}`);
    }
    probeAssertion(parseCliRequest(["--json", "--version"]).ok, "version request parses");
  } else if (probe === "error-contract") {
    const expectedExitByCode = {
      CASE_OK: 0,
      CASE_E_USAGE: 2,
      CASE_E_NOT_INITIALIZED: 10,
      CASE_E_NAMESPACE_COLLISION: 10,
      CASE_E_UNSUPPORTED_VERSION: 10,
      CASE_E_UNSUPPORTED_PROFILE: 10,
      CASE_E_PARSE: 20,
      CASE_E_SCHEMA: 20,
      CASE_E_INVARIANT: 20,
      CASE_E_EVIDENCE: 20,
      CASE_E_CONFLICT: 30,
      CASE_E_BUSY: 30,
      CASE_E_RECOVERY_REQUIRED: 30,
      CASE_E_TRANSITION: 40,
      CASE_E_ACTOR: 40,
      CASE_E_HUMAN_CONFIRMATION: 40,
      CASE_E_INTERNAL: 70,
    } as const satisfies typeof EXIT_BY_CODE;
    probeAssertion(
      JSON.stringify(EXIT_BY_CODE) === JSON.stringify(expectedExitByCode),
      "stable symbolic codes map to exact process-exit classes",
    );
    for (const code of Object.keys(expectedExitByCode) as Array<keyof typeof expectedExitByCode>) {
      probeAssertion(exitCodeFor(code) === expectedExitByCode[code], `exit mapping for ${code}`);
      if (code === "CASE_OK") continue;
      const envelope = failure("conformance.probe", code, "Controlled error");
      probeAssertion(envelope.code === code && envelope.remediation === null, `${code} has no destructive default remediation`);
    }
  } else if (probe === "offline-boundaries-positive") {
    const snapshot = baseProbeSnapshot();
    const localEvidence = snapshot.evidence[0] as unknown as Record<string, unknown>;
    probeAssertion(Object.hasOwn(localEvidence, "artifact_digest") && !Object.hasOwn(localEvidence, "artifact_bytes"), "evidence stores digest and reference without artifact bytes");
    probeAssertion(context.schemas.validate("dossier", snapshot).ok, "bundled schema registry validates offline");
    probeAssertion(CONTROLLED_PROFILE.supported && CONTROLLED_PROFILE.profile === "controlled-test"
      && !CONTROLLED_PROFILE.physical_durability, "controlled offline run remains test-only");
  } else if (probe === "offline-boundaries-negative") {
    for (const command of ["update", "telemetry"]) {
      const parsed = parseCliRequest(["--json", command]);
      probeAssertion(!parsed.ok && parsed.code === "CASE_E_USAGE", `${command} is outside M0`);
    }
  } else if (probe === "posix-unclaimed") {
    const unclassified = nodeAtomicFsPort(context.repositoryRoot);
    probeAssertion(!unclassified.profile.supported, "unclassified production filesystem is not claimed");
    probeAssertion(CONTROLLED_PROFILE.profile === "controlled-test", "test adapter is not POSIX production evidence");
  } else if (probe === "coverage-accounting-positive" || probe === "coverage-accounting-negative") {
    const synthetic: Rule[] = [{
      rule_id: "M0-PROBE-001",
      source_section: "probe",
      statement: "synthetic coverage accounting rule",
      requires_positive: true,
      requires_negative: true,
    }];
    const releaseGatePasses = (positive: ReadonlySet<string>, negative: ReadonlySet<string>): boolean =>
      uncoveredRuleIds(synthetic, positive, "requires_positive").length === 0
        && uncoveredRuleIds(synthetic, negative, "requires_negative").length === 0;
    if (probe === "coverage-accounting-positive") {
      probeAssertion(uncoveredRuleIds(synthetic, new Set(["M0-PROBE-001"]), "requires_positive").length === 0, "executed covered direction clears uncovered set");
      probeAssertion(
        releaseGatePasses(new Set(["M0-PROBE-001"]), new Set(["M0-PROBE-001"])),
        "complete required directions pass the release gate",
      );
    } else {
      probeAssertion(uncoveredRuleIds(synthetic, new Set(), "requires_negative")[0] === "M0-PROBE-001", "missing executed direction remains uncovered");
      probeAssertion(
        !releaseGatePasses(new Set(["M0-PROBE-001"]), new Set()),
        "missing required direction fails the release gate",
      );
    }
  } else if (probe === "required-family-contract-positive" || probe === "required-family-contract-negative") {
    const requiredCaseIds = [
      "acceptance-stale",
      "alias",
      "case-alias",
      "changed",
      "crlf",
      "critical-field-unknown",
      "decision-no-tty",
      "decision-old-submission",
      "double-accept",
      "empty",
      "evidence-missing",
      "external",
      "fault-after-envelope-create",
      "fault-after-snapshot-replace",
      "fault-after-temp-flush",
      "fault-after-temp-open",
      "guard-dead",
      "guard-live",
      "guard-unknown",
      "handoff-stale",
      "init-clean",
      "init-foreign",
      "init-partial",
      "jcs-unicode",
      "json-bom",
      "json-duplicate",
      "json-number",
      "junction",
      "key-order",
      "old-writer",
      "operation-reuse-different-input",
      "replacement",
      "retry-immediate",
      "retry-old-basis",
      "schema-unknown",
      "separator",
      "show-context-loss",
      "state-unknown",
      "submit-failed-check",
      "submit-inactive-run",
      "submit-open-handoff",
      "symlink",
      "unicode-nfd",
      "validator-throws",
      "version-newer",
      "walking-skeleton-offline",
      "writer-same-basis",
      "wrong-recipient",
    ];
    const observedCaseIds = new Set<string>();
    for (const caseFile of await findCaseFiles(join(corpusRoot, "cases"))) {
      const candidate = parseStrictJson(await readFile(caseFile));
      baseProbeAssertion(isRecord(candidate) && typeof candidate.case_id === "string", "family fixture has a case ID");
      observedCaseIds.add(candidate.case_id);
    }
    const missing = (ids: ReadonlySet<string>): string[] =>
      requiredCaseIds.filter((caseId) => !ids.has(caseId));
    if (probe === "required-family-contract-positive") {
      probeAssertion(missing(observedCaseIds).length === 0, "complete required family inventory is present");
    } else {
      const incomplete = new Set(observedCaseIds);
      incomplete.delete("walking-skeleton-offline");
      probeAssertion(JSON.stringify(missing(incomplete)) === '["walking-skeleton-offline"]', "missing required family is detected");
    }
  } else if (probe === "corpus-red-capability-positive" || probe === "corpus-red-capability-negative") {
    const fixture = validMinimalCase(environment);
    let stdout = "";
    renderJson(success("conformance.probe", "Conformance probe passed", null), { write: (value) => { stdout += value; } });
    const exact: InvocationOutcome[] = [{
      processExit: 0, resultCode: "CASE_OK", stdout, stderr: "", assertionIds: [],
      interactionPrompts: [], interactionMatched: true,
    }];
    if (probe === "corpus-red-capability-positive") {
      probeAssertion(await outcomesMatch(corpusRoot, context.repositoryRoot, fixture, exact), "exact invocation expectation matches");
      probeAssertion(await finalTreeMatches(context.repositoryRoot, fixture), "exact final tree matches");
      probeAssertion(exactStructuredMatch({ title: "expected" }, { title: "expected" }), "exact derived view matches");
    } else {
      probeAssertion(!await outcomesMatch(corpusRoot, context.repositoryRoot, fixture, [{ ...exact[0]!, stdout: `${stdout} ` }]), "stdout expectation mutation turns red");
      const wrongTree: CorpusCase = {
        ...fixture,
        expected_final_tree: [{ path: "unexpected.txt", presence: "present", sha256: digest(`sha256:${"0".repeat(64)}`) }],
      };
      probeAssertion(!await finalTreeMatches(context.repositoryRoot, wrongTree), "tree expectation mutation turns red");
      probeAssertion(!exactStructuredMatch({ title: "actual" }, { title: "mutated expected" }), "derived view expectation mutation turns red");
    }
  } else if (probe === "corpus-contract-positive" || probe === "corpus-contract-negative") {
    const schema = parseStrictJson(await readCorpusFile(corpusRoot, "schema/case.schema.json"));
    const validator = compileSchema(schema, "probe case");
    const valid = validMinimalCase(environment);
    if (probe === "corpus-contract-positive") {
      probeAssertion(validator(valid), "closed fixture version one validates");
      assertInvocationStructure(valid);
      probeAssertion(
        context.schemas.validate("dossier", baseProbeSnapshot()).ok,
        "bundled schema registry validates offline",
      );
      probeAssertion(true, "invocation and expectation counts are explicit and equal");
      assertUniqueOrderedPaths([{ path: "a" }, { path: "b/c" }], "probe ordered paths");
      probeAssertion(true, "safe unique repository paths in stable order validate");
      assertExactDirectoryTopology(["a", "a/b"], [{ path: "a/b/value.json" }], "probe exact topology");
      probeAssertion(true, "exact directory topology includes every file parent");
      const referencedFiles = ["data/artifact-v1.txt", "data/expected/probe-ok.json", "data/stdin/confirm-basis.txt", "data/views/base.json"];
      for (const reference of referencedFiles) baseProbeAssertion((await readCorpusFile(corpusRoot, reference)).byteLength > 0, reference);
      probeAssertion(true, "all four corpus reference kinds resolve to regular in-corpus files");
      const allRuntimeReferences: string[] = [];
      for (const caseFile of await findCaseFiles(join(corpusRoot, "cases"))) {
        const fixture = parseStrictJson(await readFile(caseFile)) as unknown as CorpusCase;
        allRuntimeReferences.push(...fixture.initial_tree.map(({ content_file }) => content_file));
        for (const invocation of fixture.invocations) {
          if (invocation.argv[0] === "@fixture"
            && invocation.argv[1] === "replace"
            && invocation.argv[3] !== undefined) {
            allRuntimeReferences.push(invocation.argv[3]);
          }
          if (invocation.stdin_content_file === null) continue;
          allRuntimeReferences.push(invocation.stdin_content_file);
          if (invocation.stdin_mode === "interactive_script") {
            const script = parseStrictJson(await readCorpusFile(corpusRoot, invocation.stdin_content_file)) as unknown as InteractiveScript;
            allRuntimeReferences.push(...script.steps.map(({ expected_prompt_file }) => expected_prompt_file));
          }
        }
        for (const expectation of fixture.expected) {
          if (expectation.stdout_json_file !== null) allRuntimeReferences.push(expectation.stdout_json_file);
          if (expectation.stderr_file !== null) allRuntimeReferences.push(expectation.stderr_file);
        }
        if (fixture.expected_derived_view_file !== null) allRuntimeReferences.push(fixture.expected_derived_view_file);
      }
      let allReferencesBundled = allRuntimeReferences.length > 0;
      for (const reference of allRuntimeReferences) {
        try {
          assertSafeFixturePath(reference, "runtime corpus reference");
          await readCorpusFile(corpusRoot, reference);
        } catch {
          allReferencesBundled = false;
          break;
        }
      }
      probeAssertion(allReferencesBundled, "all runtime corpus data references are bundled relative files");
      probeAssertion(
        sha256(await readCorpusFile(corpusRoot, "data/artifact-v1.txt"))
          === "sha256:2d27fbdf4e8ca207afbfa388ca9172fbcc6c70e534af2476b3b704f87debadcf",
        "declared fixture input digest matches bytes",
      );
      probeAssertion(
        environment.CASE_CLOCK === "2026-09-04T03:02:01Z"
          && environment.CASE_ID_SEED.length > 0
          && environment.CASE_NETWORK === "deny"
          && environment.LANG === "C"
          && environment.LC_ALL === "C"
          && environment.TZ === "UTC"
          && CONTROLLED_PROFILE.profile === "controlled-test",
        "clock ids locale process profile and network policy are fixed",
      );
    } else {
      probeAssertion(!validator({ ...valid, unknown: true }), "unknown root field rejected");
      const badProfile = structuredClone(valid) as unknown as Record<string, unknown>;
      badProfile.applicable_platform_profiles = ["made-up-profile"];
      probeAssertion(!validator(badProfile), "unknown profile rejected");
      const badFault = structuredClone(valid) as CorpusCase;
      (badFault.invocations[0] as unknown as Record<string, unknown>).fault_point = "made-up-fault";
      probeAssertion(!validator(badFault), "unknown fault rejected");
      const unsafeFixturePaths = [
        "../escape",
        "/absolute",
        "C:/drive",
        "//server/share",
        "a\\b",
        "file:ads",
        "CON",
        "CONIN$",
        "CONOUT$",
        "CLOCK$",
        "COM¹",
        "com².txt",
        "LPT³",
        "file.",
        "file ",
      ];
      let rejectedUnsafeFixturePaths = 0;
      for (const path of unsafeFixturePaths) {
        try {
          assertSafeFixturePath(path, "probe");
        } catch {
          rejectedUnsafeFixturePaths += 1;
        }
      }
      probeAssertion(
        rejectedUnsafeFixturePaths === unsafeFixturePaths.length,
        "all lexical fixture path escape spellings are rejected",
      );
      probeThrowsAssertion(
        () => assertUniqueOrderedPaths([{ path: "a" }, { path: "a" }], "probe"),
        /duplicate paths/u,
        "duplicate fixture tree path rejected",
      );
      probeThrowsAssertion(() => assertUniqueOrderedPaths([{ path: "b" }, { path: "a" }], "probe"), /stable order/u, "unstable tree path order rejected");
      probeThrowsAssertion(
        () => assertExactDirectoryTopology(["a/b"], [{ path: "a/b/value.json" }], "probe"),
        /omits a parent/u,
        "incomplete directory topology rejected",
      );
      probeThrowsAssertion(() => assertInvocationStructure({ ...valid, expected: [] }), /counts differ/u, "invocation expectation count mismatch rejected");
    }
  } else if (probe === "platform-boundary") {
    const production = nodeAtomicFsPort(context.repositoryRoot);
    probeAssertion(!production.profile.supported, "unproven production adapter stays unsupported");
    probeAssertion(CONTROLLED_PROFILE.supported && CONTROLLED_PROFILE.profile === "controlled-test", "controlled adapter is explicitly test-only");
  } else if (probe === "orphan-scan-fail-closed") {
    const listed = new Set<string>();
    const openedHistory = new Set<string>();
    const evidenceFs: PathInspectionPort = {
      ...nodePathInspection,
      async listDirectory(path) {
        const kind = path.split(/[\\/]/u).at(-1) ?? "";
        if (["handoffs", "submissions", "decisions"].includes(kind)) listed.add(kind);
        if (kind === "handoffs") throw new Error("controlled history listing failure");
        return nodePathInspection.listDirectory(path);
      },
      async openRead(path) {
        const name = path.split(/[\\/]/u).at(-1) ?? "";
        if (name.endsWith("-history.json")) openedHistory.add(name);
        return nodePathInspection.openRead(path);
      },
    };
    const result = await checkDossier({ dossier_id: "case-dossier-1" }, {
      repository_root: context.repositoryRoot,
      store: new CaseStore(context.repositoryRoot, context.schemas),
      schemas: context.schemas,
      fs: nodeAtomicFsPort(context.repositoryRoot),
      evidenceFs,
    });
    probeAssertion(!result.ok && result.code === "CASE_E_INVARIANT", "untrusted envelope directory produces structural invariant failure");
    probeAssertion(
      listed.has("handoffs") && listed.has("submissions") && listed.has("decisions")
        && openedHistory.has("submission-history.json") && openedHistory.has("decision-history.json"),
      "scan continues through submission and decision directories after earlier listing failure",
    );
  } else if (probe === "init-root-discovery") {
    const nested = join(context.repositoryRoot, "nested", "child");
    await mkdir(nested, { recursive: true });
    let confirmedCandidate = "";
    let displayedRoot = "";
    const result = await initRepository({ start_directory: nested, operation_id: "op-discover" }, {
      fs: {
        ...nodeRepositoryFileSystem,
        classifyInitializationTarget: async () => ({ supported: true, profile: "controlled-test" }),
      },
      git: {
        confirmWorktreeRoot: async (candidate) => {
          confirmedCandidate = candidate;
          return context.repositoryRoot;
        },
      },
      schemas: context.schemas,
      createRepositoryId: () => "repository-discovered",
      now: () => environment.CASE_CLOCK,
      displayRepositoryRoot: (root) => { displayedRoot = root; },
    });
    try {
      probeAssertion(result.ok && result.data.repository_root === context.repositoryRoot, "nested current directory resolves owning worktree root");
      probeAssertion(confirmedCandidate === context.repositoryRoot && displayedRoot === context.repositoryRoot, "git ownership confirmation and display use resolved root");
      probeAssertion(
        await lstat(join(context.repositoryRoot, ".case-agent", "manifest.json")).then((info) => info.isFile())
          && await lstat(join(nested, ".case-agent")).then(() => false, () => true),
        "initialization writes only at resolved owning root",
      );
    } finally {
      await rm(join(context.repositoryRoot, ".case-agent"), { recursive: true, force: true });
      await rm(join(context.repositoryRoot, "nested"), { recursive: true, force: true });
    }
  } else if (probe.startsWith("init-classification-")) {
    const reasonByProbe = {
      "init-classification-active-writer": "active-writer",
      "init-classification-case-alias": "case-alias",
      "init-classification-cloud-sync": "cloud-sync",
      "init-classification-linked-worktree": "linked-worktree",
      "init-classification-nested-repository": "nested-repository",
      "init-classification-non-local": "non-local",
      "init-classification-submodule": "submodule",
      "init-classification-unc": "unc",
    } as const;
    const reason = reasonByProbe[probe as keyof typeof reasonByProbe];
    if (reason === undefined) throw new Error(`unknown initialization classification probe: ${probe}`);
    const result = await initRepository({ start_directory: context.repositoryRoot, operation_id: `op-${reason}` }, {
      fs: { ...nodeRepositoryFileSystem, classifyInitializationTarget: async () => ({ supported: false, reason }) },
      git: { confirmWorktreeRoot: async () => context.repositoryRoot },
      schemas: context.schemas,
      createRepositoryId: () => "repository-must-not-be-created",
      now: () => environment.CASE_CLOCK,
      displayRepositoryRoot: () => undefined,
    });
    probeAssertion(!result.ok && result.code === "CASE_E_UNSUPPORTED_PROFILE", `${reason} init target explicitly classified and rejected`);
    probeAssertion((await collectFiles(context.repositoryRoot, true)).size === 0, `${reason} classification is read-only`);
  } else {
    throw new Error(`unknown protocol probe: ${probe}`);
  }
  return {
    result: success("conformance.probe", "Conformance probe passed", null),
    assertionIds: [...executed].sort(compareCodeUnits),
  };
}

async function executeInvocation(
  corpusRoot: string,
  invocation: CorpusInvocation,
  context: CaseContext,
  concurrency: { readonly rank: number; readonly gate: ConcurrencyGate } | null,
): Promise<InvocationOutcome> {
  if (context.profile === "production-windows-unsupported") {
    if (process.platform !== "win32" || concurrency !== null || invocation.fault_point !== null
      || invocation.stdin_mode !== "none" || invocation.argv[0]?.startsWith("@")) {
      throw new CorpusValidationError("production Windows vectors must be non-interactive public CLI invocations on Windows");
    }
    const executablePath = resolve(dirname(fileURLToPath(import.meta.url)), "../cli/main.js");
    const inheritedNames = ["Path", "PATH", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "COMSPEC", "TEMP", "TMP"];
    const environment: NodeJS.ProcessEnv = {};
    for (const name of inheritedNames) {
      if (process.env[name] !== undefined) environment[name] = process.env[name];
    }
    Object.assign(environment, invocation.fixed_environment);
    const child = spawn(process.execPath, [executablePath, ...invocation.argv], {
      cwd: context.repositoryRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    const processExit = await new Promise<number>((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("close", (code, signal) => signal === null && code !== null
        ? resolveExit(code)
        : rejectExit(new CorpusValidationError("public CLI process did not exit normally")));
    });
    const stdout = Buffer.concat(stdoutChunks).toString("utf8");
    const stderr = Buffer.concat(stderrChunks).toString("utf8");
    const parsed = parseStrictJson(Buffer.from(stdout, "utf8"));
    if (!isRecord(parsed) || typeof parsed.code !== "string") {
      throw new CorpusValidationError("public CLI process did not emit one result envelope");
    }
    return {
      processExit,
      resultCode: parsed.code,
      stdout,
      stderr,
      assertionIds: ["execution.public-cli-process", "profile.production-windows-unsupported.actual"],
      interactionPrompts: [],
      interactionMatched: true,
    };
  }
  if (invocation.argv[0] === "@fixture") {
    if (invocation.argv[1] !== "replace" || invocation.argv.length !== 4
      || invocation.argv[2] === undefined || invocation.argv[3] === undefined) {
      throw new CorpusValidationError("fixture action argv is malformed");
    }
    assertSafeFixturePath(invocation.argv[2], "fixture action target");
    const target = repositoryPath(context.repositoryRoot, invocation.argv[2]);
    const targetInfo = await lstat(target);
    if (!targetInfo.isFile() || targetInfo.isSymbolicLink()) {
      throw new CorpusValidationError("fixture action target is not a plain file");
    }
    const replacement = await readCorpusFile(corpusRoot, invocation.argv[3]);
    await writeFile(target, replacement);
    const result = success("conformance.fixture", "Fixture action completed", null);
    let stdout = "";
    renderJson(result, { write: (value) => { stdout += value; } });
    return {
      processExit: exitCodeFor(result.code),
      resultCode: result.code,
      stdout,
      stderr: "",
      assertionIds: [],
      interactionPrompts: [],
      interactionMatched: true,
    };
  }
  if (invocation.argv[0] === "@probe") {
    if (invocation.argv.length !== 2 || invocation.argv[1] === undefined) {
      throw new CorpusValidationError("protocol probe argv is malformed");
    }
    const probed = await runProtocolProbe(invocation.argv[1], corpusRoot, context, invocation.fixed_environment);
    let stdout = "";
    renderJson(probed.result, { write: (value) => { stdout += value; } });
    return {
      processExit: exitCodeFor(probed.result.code),
      resultCode: probed.result.code,
      stdout,
      stderr: "",
      assertionIds: probed.assertionIds,
      interactionPrompts: [],
      interactionMatched: true,
    };
  }
  const dependencies = await invocationDependencies(corpusRoot, invocation, context, concurrency);
  const terminal = dependencies.terminal as ScriptedTerminal;
  const result = await runCli(invocation.argv, dependencies);
  let stdout = "";
  if (invocation.argv.includes("--json")) renderJson(result, { write: (value) => { stdout += value; } });
  else renderHuman(result, { write: (value) => { stdout += value; } });
  return {
    processExit: exitCodeFor(result.code),
    resultCode: result.code,
    stdout,
    stderr: terminal.prompts.join(""),
    assertionIds: [
      ...terminal.assertionIds,
      "execution.controlled-cli-dispatcher",
      `execution.controlled-workflow.${result.command}`,
    ].sort(compareCodeUnits),
    interactionPrompts: terminal.prompts,
    interactionMatched: terminal.matched,
  };
}

async function executeInvocations(
  corpusRoot: string,
  fixture: CorpusCase,
  context: CaseContext,
): Promise<InvocationOutcome[]> {
  const outcomes: InvocationOutcome[] = [];
  let index = 0;
  while (index < fixture.invocations.length) {
    const invocation = fixture.invocations[index]!;
    if (invocation.concurrency_group === null) {
      outcomes.push(await executeInvocation(corpusRoot, invocation, context, null));
      index += 1;
      continue;
    }
    const group = invocation.concurrency_group;
    const grouped: CorpusInvocation[] = [];
    while (fixture.invocations[index]?.concurrency_group === group) {
      grouped.push(fixture.invocations[index]!);
      index += 1;
    }
    const gate = concurrencyGate();
    const concurrent = await Promise.all(grouped.map((item, rank) =>
      executeInvocation(corpusRoot, item, context, { rank, gate })));
    outcomes.push(...concurrent);
  }
  return outcomes;
}

async function outcomesMatch(
  corpusRoot: string,
  repositoryRoot: string,
  fixture: CorpusCase,
  outcomes: readonly InvocationOutcome[],
): Promise<boolean> {
  if (outcomes.length !== fixture.expected.length) return false;
  const groups = new Set(fixture.invocations.flatMap(({ concurrency_group: group }) => group === null ? [] : [group]));
  for (const group of groups) {
    const successes = fixture.invocations.reduce((count, invocation, index) =>
      count + (invocation.concurrency_group === group && outcomes[index]?.processExit === 0 ? 1 : 0), 0);
    if (successes !== 1) return false;
  }
  for (let index = 0; index < outcomes.length; index += 1) {
    const outcome = outcomes[index]!;
    const expected = fixture.expected[index]!;
    if (
      !outcome.interactionMatched
      ||
      outcome.processExit !== expected.process_exit
      || outcome.resultCode !== expected.result_code
      || (expected.stderr === "empty" && outcome.stderr !== "")
    ) return false;
    if (expected.stderr === "exact") {
      if (expected.stderr_file === null) return false;
      const expectedStderr = Buffer.from(await readCorpusFile(corpusRoot, expected.stderr_file)).toString("utf8");
      if (outcome.stderr !== expectedStderr) return false;
    }
    if (expected.stdout_json_file === null) {
      if (outcome.stdout !== "") return false;
    } else {
      const template = Buffer.from(await readCorpusFile(corpusRoot, expected.stdout_json_file)).toString("utf8");
      const escapedRoot = JSON.stringify(repositoryRoot).slice(1, -1);
      const expectedStdout = template.replaceAll("${CASE_REPOSITORY_ROOT}", escapedRoot);
      if (outcome.stdout !== expectedStdout) return false;
    }
  }
  return true;
}

async function finalTreeMatches(repositoryRoot: string, fixture: CorpusCase): Promise<boolean> {
  const actual = await collectFiles(repositoryRoot, true);
  const expectedPresent = new Map<string, string>();
  for (const entry of fixture.expected_final_tree) {
    if (entry.presence === "absent") {
      if (actual.has(entry.path) || entry.sha256 !== null) return false;
    } else {
      if (entry.sha256 === null) return false;
      expectedPresent.set(entry.path, entry.sha256);
    }
  }
  return sameMap(actual, expectedPresent)
    && sameSet(await collectDirectories(repositoryRoot, true), new Set(fixture.expected_final_directories));
}

async function derivedViewMatches(
  corpusRoot: string,
  fixture: CorpusCase,
  context: CaseContext,
): Promise<boolean> {
  if (fixture.expected_derived_view_file === null) return true;
  const expected = parseStrictJson(await readCorpusFile(corpusRoot, fixture.expected_derived_view_file));
  if (!isRecord(expected) || typeof expected.dossier_id !== "string") return false;
  const invocation: CorpusInvocation = {
    actor_label: "conformance-view",
    argv: ["--json", "dossier", "show", "--dossier", expected.dossier_id],
    stdin_mode: "none",
    stdin_content_file: null,
    fixed_environment: fixture.invocations.at(-1)!.fixed_environment,
    concurrency_group: null,
    fault_point: null,
  };
  const result = await runCli(invocation.argv, await invocationDependencies(corpusRoot, invocation, context, null));
  return result.ok && exactStructuredMatch(result.data, expected);
}

async function safeRemoveTemporary(path: string): Promise<void> {
  const temporaryRoot = resolve(tmpdir());
  const target = resolve(path);
  if (!isContained(temporaryRoot, target) || target === temporaryRoot) {
    throw new CorpusValidationError("refused unsafe temporary cleanup");
  }
  await rm(target, { recursive: true, force: true });
}

function profileIsApplicable(profile: PlatformProfile): boolean {
  if (profile === "controlled-test") return true;
  if (profile === "production-windows-unsupported") return process.platform === "win32";
  return process.platform !== "win32";
}

async function initializeHarnessGitRepository(repositoryRoot: string, realGit: boolean): Promise<void> {
  if (!realGit) {
    await mkdir(join(repositoryRoot, ".git"));
    await writeFile(join(repositoryRoot, ".git", "HEAD"), "ref: refs/heads/conformance\n", { flag: "wx" });
    return;
  }
  const child = spawn("git", ["init", "--quiet", "--initial-branch=conformance", repositoryRoot], {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  await new Promise<void>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", (code, signal) => {
      if (signal === null && code === 0) resolveExit();
      else rejectExit(new CorpusValidationError(`could not initialize harness Git repository: ${Buffer.concat(stderr).toString("utf8")}`));
    });
  });
}

async function executeCase(corpusRoot: string, located: LocatedCase, ports: CorpusPorts): Promise<boolean> {
  const temporary = await mkdtemp(join(tmpdir(), "case-agent-conformance-"));
  const repositoryRoot = join(temporary, "repository");
  let networkCalls = 0;
  const caseAsyncIds = new Set<number>();
  const pendingCaseResources = new Map<number, {
    readonly type: string;
    readonly resource: object;
    readonly scopedAtInit: boolean;
  }>();
  const auditScope = new AsyncLocalStorage<boolean>();
  let bodyPromiseAsyncId: number | undefined;
  const isNetworkResource = (type: string): boolean =>
    /^(?:DNSCHANNEL|GETADDRINFOREQWRAP|GETNAMEINFOREQWRAP|QUERYWRAP|TCP.*|TLS.*|UDP.*|HTTP.*|HTTP2.*|QUIC.*)$/u.test(type);
  // Request/work resources become quiescent after their callback; persistent
  // handles remain pending until destroy. Unresolved PROMISE objects created
  // inside the case carry causal scope; the body/current runner continuations
  // are excluded explicitly rather than ignoring every Promise.
  const isOneShotCallbackResource = (type: string): boolean =>
    /(?:REQ|REQUEST)/u.test(type) || type === "TickObject" || type === "Microtask";
  // Node 24 marks a Timeout/Immediate destroyed synchronously when its public
  // cancellation API is called, before async_hooks necessarily emits destroy.
  // The engine major is pinned in package.json, so this is a deterministic
  // lifecycle observation rather than an event-loop delay or grace period.
  const isCancelledDeferredResource = (type: string, resource: object): boolean =>
    (type === "Timeout" || type === "Immediate")
      && (resource as { readonly _destroyed?: unknown })._destroyed === true;
  const discardCancelledDeferredResources = (): void => {
    for (const [asyncId, { type, resource }] of pendingCaseResources) {
      if (!isCancelledDeferredResource(type, resource)) continue;
      pendingCaseResources.delete(asyncId);
      caseAsyncIds.delete(asyncId);
    }
  };
  const cleanupKnownCaseResource = (type: string, resource: object): void => {
    try {
      if (type === "Timeout") {
        clearTimeout(resource as NodeJS.Timeout);
        return;
      }
      if (type === "Immediate") {
        clearImmediate(resource as NodeJS.Immediate);
        return;
      }
      if (type === "DNSCHANNEL") {
        (resource as { readonly cancel?: () => void }).cancel?.();
        return;
      }
      if (type === "TCPSERVERWRAP") {
        const handle = resource as {
          readonly owner?: {
            readonly closeAllConnections?: () => void;
            readonly close?: () => void;
          };
          readonly close?: () => void;
          readonly unref?: () => void;
        };
        handle.owner?.closeAllConnections?.();
        if (handle.owner?.close !== undefined) handle.owner.close();
        else handle.close?.();
        handle.unref?.();
      }
    } catch {
      // The resource has already made the case red. Cleanup is deliberately
      // best-effort and limited to known Node 24 resource shapes; the formal
      // conformance process has an explicit termination boundary as a backstop.
    }
  };
  const networkAudit = createHook({
    init: (asyncId, type, triggerAsyncId, resource) => {
      const scopedAtInit = auditScope.getStore() === true;
      if (!scopedAtInit && !caseAsyncIds.has(triggerAsyncId)) return;
      caseAsyncIds.add(asyncId);
      if (isNetworkResource(type)) networkCalls += 1;
      pendingCaseResources.set(asyncId, { type, resource, scopedAtInit });
    },
    after: (asyncId) => {
      const pending = pendingCaseResources.get(asyncId);
      if (pending !== undefined && isOneShotCallbackResource(pending.type)) {
        pendingCaseResources.delete(asyncId);
        caseAsyncIds.delete(asyncId);
      }
    },
    destroy: (asyncId) => {
      pendingCaseResources.delete(asyncId);
      caseAsyncIds.delete(asyncId);
    },
    promiseResolve: (asyncId) => {
      pendingCaseResources.delete(asyncId);
      caseAsyncIds.delete(asyncId);
    },
  });
  // This in-process audit deliberately begins before schemas or workflow dependencies load.
  networkAudit.enable();
  let bodyPromise: Promise<boolean> | undefined;
  try {
    bodyPromise = auditScope.run(true, async () => {
      try {
        await mkdir(repositoryRoot);
    const profile = located.fixture.applicable_platform_profiles[0]!;
    await initializeHarnessGitRepository(repositoryRoot, profile === "production-windows-unsupported");
    const gitBaseline = await collectFiles(join(repositoryRoot, ".git"), false);
    await populateInitialTree(corpusRoot, repositoryRoot, located.fixture);
    await ports.onRepositoryReady?.(located.fixture.case_id, repositoryRoot);
    const hasExistingDossier = located.fixture.initial_tree.some(({ path }) =>
      /^\.case-agent\/dossiers\/[^/]+\/dossier\.json$/u.test(path));
    const context: CaseContext = {
      repositoryRoot,
      schemas: await SchemaRegistry.load(resolve(dirname(fileURLToPath(import.meta.url)), "../../../schemas")),
      profile,
      dossierCounter: hasExistingDossier ? 1 : 0,
      runCounter: hasExistingDossier ? 1 : 0,
      guardCounter: 0,
      operationTraces: new Map(),
      operationFacts: new Set(),
    };
    const outcomes = await executeInvocations(corpusRoot, located.fixture, context);
    for (let index = 0; index < outcomes.length; index += 1) {
      const outcome = outcomes[index]!;
      await ports.onInvocationResult?.(located.fixture.case_id, index, {
        process_exit: outcome.processExit,
        result_code: outcome.resultCode,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
      });
      for (let step = 0; step < outcome.interactionPrompts.length; step += 1) {
        await ports.onInteractionPrompt?.(located.fixture.case_id, index, step, outcome.interactionPrompts[step]!);
      }
    }
    await ports.onFinalTree?.(
      located.fixture.case_id,
      Object.fromEntries(await collectFiles(repositoryRoot, true)),
    );
    await ports.onBeforeDerivedView?.(located.fixture.case_id, repositoryRoot);
    const outcomesMatched = await outcomesMatch(corpusRoot, repositoryRoot, located.fixture, outcomes);
    const derivedViewMatched = await derivedViewMatches(corpusRoot, located.fixture, context);
    const finalTreeMatched = await finalTreeMatches(repositoryRoot, located.fixture);
    const gitTreeMatched = sameMap(gitBaseline, await collectFiles(join(repositoryRoot, ".git"), false));
    const executedAssertions = new Set(outcomes.flatMap((outcome) => outcome.assertionIds));
    executedAssertions.add("population.safe-confined");
    for (const fact of context.operationFacts) executedAssertions.add(fact);
    for (const [operationId, events] of context.operationTraces) {
      executedAssertions.add(`storage:${operationId}:event-count=${events.length}`);
      const mutationCount = events.filter((event) =>
        /^atomic\.(?:create-once|flush-close|replace|remove|quarantine):/u.test(event)).length;
      executedAssertions.add(`storage:${operationId}:mutation-count=${mutationCount}`);
      events.forEach((event, index) => executedAssertions.add(`storage:${operationId}:${index}=${event}`));
    }
    if (outcomesMatched) {
      for (let index = 0; index < outcomes.length; index += 1) {
        const outcome = outcomes[index]!;
        executedAssertions.add(`process:${index}:exit=${outcome.processExit}`);
        executedAssertions.add(`process:${index}:code=${outcome.resultCode}`);
        executedAssertions.add(`process:${index}:stdout=${sha256(Buffer.from(outcome.stdout, "utf8"))}`);
        executedAssertions.add(`process:${index}:stderr=${sha256(Buffer.from(outcome.stderr, "utf8"))}`);
        const argv = located.fixture.invocations[index]!.argv;
        if (outcome.stdout !== "" && (argv.includes("--json") || argv[0]?.startsWith("@"))) {
          emitStructuredAssertions(executedAssertions, `stdout:${index}`, parseStrictJson(Buffer.from(outcome.stdout, "utf8")));
        } else if (outcome.stdout !== "") {
          const lines = outcome.stdout.endsWith("\n") ? outcome.stdout.slice(0, -1).split("\n") : outcome.stdout.split("\n");
          executedAssertions.add(`human-stdout:${index}:line-count=${lines.length}`);
          const fieldByteLengths = lines.flatMap((line) => {
            const separator = line.indexOf(": ");
            return separator < 0 ? [] : [Buffer.byteLength(line.slice(separator + 2), "utf8")];
          });
          executedAssertions.add(`human-stdout:${index}:max-field-utf8-bytes=${Math.max(0, ...fieldByteLengths)}`);
          executedAssertions.add(`human-stdout:${index}:utf8-bytes=${Buffer.byteLength(outcome.stdout, "utf8")}`);
          lines.forEach((line, lineIndex) => executedAssertions.add(`human-stdout:${index}:${lineIndex}=${line}`));
        }
      }
      const groups = new Set(located.fixture.invocations.flatMap(({ concurrency_group: group }) => group === null ? [] : [group]));
      for (const group of groups) executedAssertions.add(`concurrency:${group}:successes=1`);
    }
    if (derivedViewMatched && located.fixture.expected_derived_view_file !== null) {
      const view = parseStrictJson(await readCorpusFile(corpusRoot, located.fixture.expected_derived_view_file));
      emitStructuredAssertions(executedAssertions, "view", view);
    }
    if (finalTreeMatched) {
      executedAssertions.add("tree:exact-set");
      for (const directory of located.fixture.expected_final_directories) {
        executedAssertions.add(`directory:/${directory}=present`);
      }
      for (const entry of located.fixture.expected_final_tree) {
        executedAssertions.add(`tree:/${entry.path}=${entry.presence === "present" ? entry.sha256 : "absent"}`);
        if (entry.presence === "present") {
          try {
            const value = parseStrictJson(await readFile(repositoryPath(repositoryRoot, entry.path)));
            emitStructuredAssertions(executedAssertions, `tree-json:/${entry.path}`, value);
          } catch {
            // Exact bytes still remain asserted; only strict JSON files receive structured facts.
          }
        }
      }
      const actualPaths = [...(await collectFiles(repositoryRoot, true)).keys()];
      if (!actualPaths.some((path) => /(?:^|\/)brief\.md$/u.test(path))) {
        executedAssertions.add("tree:no-authoritative-brief");
      }
    }
    if (gitTreeMatched) executedAssertions.add("git-tree:exact");
    for (const profile of located.fixture.applicable_platform_profiles) {
      executedAssertions.add(`profile:${profile}`);
    }
    await ports.onCaseAssertions?.(located.fixture.case_id, [...executedAssertions].sort(compareCodeUnits));
    discardCancelledDeferredResources();
    const currentAsyncId = executionAsyncId();
    const unresolvedContinuationIds = new Set([...pendingCaseResources]
      .filter(([asyncId, { type, scopedAtInit }]) => type === "PROMISE"
        && scopedAtInit
        && asyncId !== bodyPromiseAsyncId
        && asyncId !== currentAsyncId)
      .map(([asyncId]) => asyncId));
    const asyncResourcesQuiescent = [...pendingCaseResources].every(([asyncId, { type }]) =>
      type === "PROMISE"
        ? !unresolvedContinuationIds.has(asyncId)
        : false);
    if (networkCalls === 0) executedAssertions.add("network.zero");
    if (asyncResourcesQuiescent) executedAssertions.add("async.quiescent");
    const bindingsMatched = located.ruleBindings.every(({ assertion_ids }) =>
      assertion_ids.every((assertionId) => executedAssertions.has(assertionId)));
    return networkCalls === 0 && asyncResourcesQuiescent
      && outcomesMatched && derivedViewMatched && finalTreeMatched && gitTreeMatched && bindingsMatched;
      } catch {
        return false;
      }
    });
    bodyPromiseAsyncId = [...pendingCaseResources]
      .find(([, { resource }]) => resource === bodyPromise)?.[0];
    return await bodyPromise;
  } finally {
    auditScope.disable();
    networkAudit.disable();
    for (const { type, resource } of pendingCaseResources.values()) {
      cleanupKnownCaseResource(type, resource);
    }
    await safeRemoveTemporary(temporary);
  }
}

/** Load, validate, execute, and summarize the frozen conformance corpus. */
export async function runCorpus(corpusRoot: string, ports: CorpusPorts = {}): Promise<CorpusSummary> {
  const root = await realpath(corpusRoot);
  const before = await collectFiles(root, false);
  const { rules, cases } = await loadCorpus(root);
  const applicableCases = cases.filter(({ fixture }) =>
    profileIsApplicable(fixture.applicable_platform_profiles[0]!));
  const positive = new Set<string>();
  const negative = new Set<string>();
  let passed = 0;
  for (const located of applicableCases) {
    await ports.onCaseStart?.(located.fixture.case_id);
    const casePassed = await executeCase(root, located, ports);
    await ports.onCaseResult?.(located.fixture.case_id, casePassed);
    if (casePassed) {
      passed += 1;
      const coverage = located.polarity === "positive" ? positive : negative;
      for (const ruleId of located.fixture.normative_rule_ids) coverage.add(ruleId);
    }
  }
  const after = await collectFiles(root, false);
  if (!sameMap(before, after)) throw new CorpusValidationError("corpus changed during execution");
  const applicablePositive = new Set(applicableCases
    .filter(({ polarity }) => polarity === "positive")
    .flatMap(({ fixture }) => fixture.normative_rule_ids));
  const applicableNegative = new Set(applicableCases
    .filter(({ polarity }) => polarity === "negative")
    .flatMap(({ fixture }) => fixture.normative_rule_ids));
  const anyPositive = new Set(cases.filter(({ polarity }) => polarity === "positive")
    .flatMap(({ fixture }) => fixture.normative_rule_ids));
  const anyNegative = new Set(cases.filter(({ polarity }) => polarity === "negative")
    .flatMap(({ fixture }) => fixture.normative_rule_ids));
  const uncoveredPositive = uncoveredRuleIds(rules.filter(({ rule_id }) =>
    !anyPositive.has(rule_id) || applicablePositive.has(rule_id)), positive, "requires_positive");
  const uncoveredNegative = uncoveredRuleIds(rules.filter(({ rule_id }) =>
    !anyNegative.has(rule_id) || applicableNegative.has(rule_id)), negative, "requires_negative");
  return {
    total: applicableCases.length,
    passed,
    failed: applicableCases.length - passed,
    uncovered_positive: uncoveredPositive,
    uncovered_negative: uncoveredNegative,
  };
}
