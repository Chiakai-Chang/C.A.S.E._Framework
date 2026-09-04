import { createHash } from "node:crypto";
import { createHook } from "node:async_hooks";
import {
  lstat,
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
import { runCli, type CliDependencies, type CliTerminal } from "../cli/main.js";
import { renderJson } from "../cli/render.js";
import { canonicalize, digestProjection } from "../protocol/canonical.js";
import { buildChecksProjection } from "../protocol/checks.js";
import { EXIT_BY_CODE, exitCodeFor } from "../protocol/errors.js";
import { parseGovernedJson } from "../protocol/json.js";
import { projectChecks, projectContent, projectObservedEvidence, projectState } from "../protocol/projections.js";
import { failure, success, type ResultEnvelope } from "../protocol/result.js";
import { SchemaRegistry } from "../protocol/schema-registry.js";
import {
  digest,
  isDigest,
  isRevision,
  revision,
  type CurrentView,
  type DossierSnapshot,
  type ObservedEvidenceProjection,
} from "../protocol/types.js";
import { nodeAtomicFsPort, type AtomicFsPort, type AtomicPublicationProfile } from "../storage/atomic.js";
import { recoverWriterGuard } from "../storage/guard.js";
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
}

type Rule = {
  readonly rule_id: string;
  readonly source_section: string;
  readonly statement: string;
  readonly requires_positive: boolean;
  readonly requires_negative: boolean;
};

type FixedEnvironment = {
  readonly CASE_CLOCK: string;
  readonly CASE_ID_SEED: string;
  readonly CASE_PROCESS_PROFILE: "controlled-test";
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
  readonly stderr: "empty" | "startup_failure_only";
};

type CorpusCase = {
  readonly fixture_version: "1";
  readonly case_id: string;
  readonly normative_rule_ids: string[];
  readonly applicable_platform_profiles: Array<
    "controlled-test" | "production-windows-unsupported" | "production-posix-unclaimed"
  >;
  readonly initial_tree: Array<{ readonly path: string; readonly content_file: string; readonly sha256: string }>;
  readonly invocations: CorpusInvocation[];
  readonly expected: CorpusExpectation[];
  readonly expected_final_tree: Array<{
    readonly path: string;
    readonly presence: "present" | "absent";
    readonly sha256: string | null;
  }>;
  readonly expected_derived_view_file: string | null;
};

type LocatedCase = {
  readonly fixture: CorpusCase;
  readonly caseFile: string;
  readonly polarity: "positive" | "negative";
};

type InvocationOutcome = {
  readonly processExit: number;
  readonly resultCode: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly assertedRuleIds: readonly string[] | null;
};

class CorpusValidationError extends Error {
  constructor(message: string) {
    super(`CASE_E_CONFORMANCE: ${message}`);
  }
}

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
    if (depth > 256) this.invalid("nesting exceeds 256 containers");
    const next = this.peek();
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
    const result: Record<string, unknown> = {};
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
      result[key] = this.value(depth);
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
  if (
    path.length === 0
    || path.includes("\0")
    || path.includes("\\")
    || path.startsWith("/")
    || path.startsWith("//")
    || /^[A-Za-z]:/u.test(path)
    || path.includes("//")
    || path.split("/").some((part) => part.length === 0 || part === "." || part === "..")
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
  const environment = JSON.stringify(fixture.invocations[0]!.fixed_environment);
  if (fixture.invocations.some((invocation) => JSON.stringify(invocation.fixed_environment) !== environment)) {
    throw new CorpusValidationError(`${fixture.case_id} changes fixed environment between invocations`);
  }
  for (const expectation of fixture.expected) {
    if (expectation.stderr === "empty" && expectation.stdout_json_file === null) {
      throw new CorpusValidationError(`${fixture.case_id} leaves normal stdout implicit`);
    }
    if (expectation.stderr === "startup_failure_only" && expectation.stdout_json_file !== null) {
      throw new CorpusValidationError(`${fixture.case_id} mixes startup stderr with a normal stdout envelope`);
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
  const validateRules = compileSchema(rulesSchema, "rules");
  const validateCase = compileSchema(caseSchema, "case");
  const rulesValue = parseStrictJson(await readCorpusFile(corpusRoot, "rules.json"));
  validateWith(validateRules, rulesValue, "rules.json");
  const rules = rulesValue as Rule[];
  const ruleIds = rules.map(({ rule_id }) => rule_id);
  if (new Set(ruleIds).size !== ruleIds.length) throw new CorpusValidationError("rules.json has duplicate rule IDs");

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
    for (const ruleId of fixture.normative_rule_ids) {
      if (!knownRules.has(ruleId)) throw new CorpusValidationError(`${fixture.case_id} references unknown rule ${ruleId}`);
    }
    assertUniqueOrderedPaths(fixture.initial_tree, `${fixture.case_id} initial_tree`);
    assertUniqueOrderedPaths(fixture.expected_final_tree, `${fixture.case_id} expected_final_tree`);
    assertInvocationStructure(fixture);
    for (const entry of fixture.initial_tree) {
      const bytes = await readCorpusFile(corpusRoot, entry.content_file);
      if (sha256(bytes) !== entry.sha256) {
        throw new CorpusValidationError(`${fixture.case_id} initial content digest mismatch: ${entry.path}`);
      }
    }
    for (const invocation of fixture.invocations) {
      if (invocation.stdin_content_file !== null) {
        await readCorpusFile(corpusRoot, invocation.stdin_content_file);
      }
    }
    for (const expectation of fixture.expected) {
      if (expectation.stdout_json_file !== null) {
        parseStrictJson(await readCorpusFile(corpusRoot, expectation.stdout_json_file));
      }
    }
    if (fixture.expected_derived_view_file !== null) {
      parseStrictJson(await readCorpusFile(corpusRoot, fixture.expected_derived_view_file));
    }
    cases.push({ fixture, caseFile, polarity: polarityFor(corpusRoot, caseFile) });
  }
  return { rules, cases };
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
  for (const entry of fixture.initial_tree) {
    const bytes = await readCorpusFile(corpusRoot, entry.content_file);
    const target = await createDestinationParent(repositoryRoot, entry.path);
    await writeFile(target, bytes, { flag: "wx" });
    const exact = await realpath(target);
    if (!isContained(await realpath(repositoryRoot), exact)) {
      throw new CorpusValidationError(`${fixture.case_id} populated a path outside its repository`);
    }
  }
}

class ScriptedTerminal implements CliTerminal {
  readonly interactive: boolean;
  private readonly lines: string[];

  constructor(mode: CorpusInvocation["stdin_mode"], input: string) {
    this.interactive = mode === "interactive_script";
    this.lines = input.split(/\r?\n/u).filter((line) => line.length > 0);
  }

  async confirmBasis(_view: CurrentView): Promise<boolean> {
    return this.interactive && this.lines.shift() === "CONFIRM THIS BASIS";
  }

  async confirmDecision(_review: never, phrase: string): Promise<boolean> {
    return this.interactive && this.lines.shift() === phrase;
  }

  async confirmRecovery(): Promise<boolean> {
    return this.interactive && this.lines.shift() === "RECOVER THIS WRITER GUARD";
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
): AtomicFsPort {
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
    readFile: async (relativePath) => readFile(path(relativePath)),
    async createOnce(relativePath, bytes) {
      const isWriterGuard = /[\\/]locks[\\/][^\\/]+\.lock$/u.test(relativePath);
      if (isWriterGuard && concurrency !== null && concurrency.rank > 0) {
        await concurrency.gate.firstLockCreated;
      }
      const handle = await open(path(relativePath), "wx");
      try { await handle.writeFile(bytes); } finally { await handle.close(); }
      if (isWriterGuard && concurrency !== null && concurrency.rank === 0) {
        concurrency.gate.signalFirstLock();
      }
      if (relativePath.includes(".tmp-")) inject("after_temp_open");
      if (/[\\/](?:handoffs|submissions|decisions)[\\/]/u.test(relativePath)) {
        inject("after_envelope_create");
      }
    },
    async flushFile(relativePath) {
      const handle = await open(path(relativePath), "r+");
      try { await handle.sync(); } finally { await handle.close(); }
      if (relativePath.includes(".tmp-")) inject("after_temp_flush");
    },
    async replaceCurrent(tempPath, targetPath) {
      const temp = path(tempPath);
      const target = path(targetPath);
      if (dirname(temp) !== dirname(target)) throw new Error("cross-directory controlled replacement");
      await rename(temp, target);
      inject("after_snapshot_replace");
    },
    remove: async (relativePath) => unlink(path(relativePath)),
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
  readonly environment: FixedEnvironment;
  dossierCounter: number;
  runCounter: number;
  guardCounter: number;
};

async function invocationDependencies(
  corpusRoot: string,
  invocation: CorpusInvocation,
  context: CaseContext,
  concurrency: { readonly rank: number; readonly gate: ConcurrencyGate } | null,
): Promise<CliDependencies> {
  const fs = controlledAtomicFs(context.repositoryRoot, invocation.fault_point, concurrency);
  const store = new CaseStore(context.repositoryRoot, context.schemas);
  const dossiers: DossierDirectoryPublicationPort = {
    profile: CONTROLLED_PROFILE,
    publishCreateOnce: (path, contents) => publishDossierDirectory(context.repositoryRoot, path, contents),
  };
  const ports: WorkflowPorts = {
    repository_root: context.repositoryRoot,
    store,
    schemas: context.schemas,
    evidenceFs: nodePathInspection,
    fs,
    dossiers,
    processIdentity: {
      current: async () => ({
        profile: context.environment.CASE_PROCESS_PROFILE,
        pid: context.environment.CASE_PROCESS_PID,
        process_started_at: context.environment.CASE_PROCESS_STARTED_AT,
      }),
      verifyTerminated: async () => context.environment.CASE_PROCESS_STATUS,
    },
    clock: {
      now: () => context.environment.CASE_CLOCK,
      isPossiblyStale: () => true,
    },
    ids: {
      createGuardId: () => `${context.environment.CASE_ID_SEED}-guard-${++context.guardCounter}`,
      tempIdFor: (guardId) => `temp-${guardId}`,
      envelopeIdFor: (kind, operationId) => `${kind}-${operationId}`,
      createDossierId: () => `${context.environment.CASE_ID_SEED}-dossier-${++context.dossierCounter}`,
      createRunId: () => `${context.environment.CASE_ID_SEED}-run-${++context.runCounter}`,
      evidenceIdFor: (operationId) => `evidence-${operationId}`,
    },
  };
  const input = invocation.stdin_content_file === null
    ? ""
    : Buffer.from(await readCorpusFile(corpusRoot, invocation.stdin_content_file)).toString("utf8");
  const terminal = new ScriptedTerminal(invocation.stdin_mode, input);
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
        createRepositoryId: () => `${context.environment.CASE_ID_SEED}-repository`,
        now: () => context.environment.CASE_CLOCK,
        displayRepositoryRoot: () => undefined,
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

function probeAssertion(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`probe assertion failed: ${message}`);
}

function probeThrows(action: () => unknown, pattern: RegExp): void {
  let observed: unknown;
  try {
    action();
  } catch (error) {
    observed = error;
  }
  probeAssertion(observed instanceof Error && pattern.test(observed.message), `expected ${pattern.source}`);
}

async function probeRejects(action: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  let observed: unknown;
  try {
    await action();
  } catch (error) {
    observed = error;
  }
  probeAssertion(observed instanceof Error && pattern.test(observed.message), `expected ${pattern.source}`);
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
    initial_tree: [],
    invocations: [{
      actor_label: "probe",
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
    }],
    expected_final_tree: [],
    expected_derived_view_file: null,
  };
}

async function runProtocolProbe(
  probe: string,
  corpusRoot: string,
  context: CaseContext,
): Promise<{ readonly result: ResultEnvelope<null>; readonly assertedRuleIds: readonly string[] }> {
  let assertedRuleIds: readonly string[];
  if (probe === "strict-json-valid") {
    const bytes = Buffer.from('{"a":[true,null,"text"],"\\u0062":"\\ud83d\\ude00"}', "utf8");
    probeAssertion(bytes[0] !== 0xef, "plain UTF-8 has no BOM");
    probeAssertion(JSON.stringify(parseGovernedJson(bytes)) === '{"a":[true,null,"text"],"b":"😀"}', "valid strict number-free JSON");
    assertedRuleIds = ["M0-PARSE-001", "M0-PARSE-002", "M0-PARSE-003", "M0-PARSE-004", "M0-PARSE-005"];
  } else if (probe === "json-duplicate") {
    probeThrows(() => parseGovernedJson(Buffer.from('{"a":true,"\\u0061":false}', "utf8")), /CASE_E_PARSE/u);
    assertedRuleIds = ["M0-PARSE-002"];
  } else if (probe === "json-number") {
    probeThrows(() => parseGovernedJson(Buffer.from('{"value":1}', "utf8")), /CASE_E_PARSE/u);
    assertedRuleIds = ["M0-PARSE-004"];
  } else if (probe === "json-bom") {
    probeThrows(() => parseGovernedJson(Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), /CASE_E_PARSE/u);
    assertedRuleIds = ["M0-PARSE-005"];
  } else if (probe === "json-invalid-utf8") {
    probeThrows(() => parseGovernedJson(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d])), /CASE_E_PARSE/u);
    assertedRuleIds = ["M0-PARSE-001"];
  } else if (probe === "json-invalid-unicode") {
    probeThrows(() => parseGovernedJson(Buffer.from('{"x":"\\ud800"}', "utf8")), /CASE_E_PARSE/u);
    probeThrows(() => parseGovernedJson(Buffer.from('{"x":"\\ufdd0"}', "utf8")), /CASE_E_PARSE/u);
    assertedRuleIds = ["M0-PARSE-003"];
  } else if (probe === "crlf") {
    probeAssertion(JSON.stringify(parseGovernedJson(Buffer.from("{\r\n\t\"a\": true\r\n}\r\n", "utf8"))) === '{"a":true}', "CRLF JSON");
    assertedRuleIds = ["M0-PARSE-001"];
  } else if (probe === "schema-valid") {
    const manifest = {
      protocol: "case-agent",
      protocol_version: "0.1.0-preview",
      schema_dialect: "https://json-schema.org/draft/2020-12/schema",
      repository_id: "repository-a",
      created_at: context.environment.CASE_CLOCK,
    };
    probeAssertion(context.schemas.validate("manifest", manifest).ok, "valid bundled manifest root");
    probeAssertion(!context.schemas.validate("manifest", { ...manifest, unknown: true }).ok, "critical roots are closed");
    probeAssertion(!context.schemas.validate("manifest", { ...manifest, created_at: "2026-02-30T03:02:01Z" }).ok, "timestamp semantics do not rely on format annotation alone");
    const schemaDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../schemas");
    for (const entry of await readdir(schemaDirectory)) {
      if (!entry.endsWith(".schema.json")) continue;
      const schema = JSON.parse(await readFile(join(schemaDirectory, entry), "utf8")) as Record<string, unknown>;
      probeAssertion(schema.$schema === "https://json-schema.org/draft/2020-12/schema", `${entry} dialect`);
      probeAssertion(typeof schema.$id === "string" && schema.$id.length > 0, `${entry} stable id`);
    }
    assertedRuleIds = ["M0-SCHEMA-001", "M0-SCHEMA-002", "M0-SCHEMA-003", "M0-SCHEMA-004", "M0-SCHEMA-005", "M0-STATE-001"];
  } else if (probe === "schema-unknown") {
    const snapshot = { ...baseProbeSnapshot(), unexpected: true };
    probeAssertion(!context.schemas.validate("dossier", snapshot).ok, "unknown dossier field rejected");
    assertedRuleIds = ["M0-SCHEMA-004", "M0-SCHEMA-005", "M0-STATE-002"];
  } else if (probe === "jcs-unicode") {
    const nfc = { "😀": "é", z: "last", a: "first" };
    const nfd = { "😀": "e\u0301", z: "last", a: "first" };
    probeAssertion(canonicalize(nfc) === '{"a":"first","z":"last","😀":"é"}', "UTF-16 key order");
    probeAssertion(digestProjection(nfc) !== digestProjection(nfd), "Unicode is not normalized");
    assertedRuleIds = ["M0-JCS-001", "M0-JCS-002"];
  } else if (probe === "key-order") {
    probeAssertion(canonicalize({ z: true, a: false, aa: null }) === '{"a":false,"aa":null,"z":true}', "canonical key order");
    assertedRuleIds = ["M0-JCS-001"];
  } else if (probe === "unicode-nfd") {
    probeAssertion(canonicalize(["é"]) !== canonicalize(["e\u0301"]), "NFC and NFD remain distinct");
    assertedRuleIds = ["M0-JCS-002"];
  } else if (probe === "scalar-valid") {
    probeAssertion(isRevision("0") && isRevision("314") && !isRevision("01"), "revision grammar");
    probeAssertion(isDigest(`sha256:${"a".repeat(64)}`) && !isDigest(`sha256:${"A".repeat(64)}`), "digest grammar");
    probeAssertion(context.schemas.validate("manifest", {
      protocol: "case-agent",
      protocol_version: "0.1.0-preview",
      schema_dialect: "https://json-schema.org/draft/2020-12/schema",
      repository_id: "opaque-id",
      created_at: "2026-09-04T03:02:01Z",
    }).ok, "UTC timestamp");
    assertedRuleIds = ["M0-SCALAR-001", "M0-SCALAR-003", "M0-SCALAR-004", "M0-SCALAR-005", "M0-SCALAR-006"];
  } else if (probe === "scalar-invalid") {
    probeAssertion(!isRevision("-1") && !isRevision("01") && !isDigest(`sha256:${"A".repeat(64)}`), "invalid scalar forms rejected");
    probeAssertion(!context.schemas.validate("manifest", {
      protocol: "case-agent",
      protocol_version: "0.1.0-preview",
      schema_dialect: "https://json-schema.org/draft/2020-12/schema",
      repository_id: "opaque-id",
      created_at: "2026-09-04T03:02:01+08:00",
    }).ok, "non-Z timestamp rejected");
    assertedRuleIds = ["M0-SCALAR-001", "M0-SCALAR-004", "M0-SCALAR-005", "M0-SCALAR-006"];
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
    probeAssertion(!Object.hasOwn(projectedState, "state_digest") && Object.keys(projectedState).length === 13, "state projection exact exclusion");
    probeAssertion(!JSON.stringify(projectedContent).includes("captured_at") && !Object.hasOwn(projectedContent, "title"), "content projection exclusions");
    probeAssertion(JSON.stringify(projectedObserved).includes('"stable_limitation_codes":["A_LIMIT","Z_LIMIT"]'), "observed order");
    probeAssertion(checks.verdict === "passed" && (projectedChecks.criterion_results as unknown[]).length === 2, "checks semantics");
    assertedRuleIds = [
      "M0-PROJECTION-001", "M0-PROJECTION-002", "M0-PROJECTION-003", "M0-PROJECTION-004",
      "M0-PROJECTION-005", "M0-PROJECTION-006", "M0-PROJECTION-007", "M0-PROJECTION-008",
      "M0-STATE-003", "M0-STATE-005", "M0-STATE-006",
    ];
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
    probeAssertion(failed.verdict === "failed", "changed evidence fails checks");
    const changedTitle = { ...snapshot, title: "Other display title" };
    probeAssertion(digestProjection(projectContent(changedTitle)) === digestProjection(projectContent(snapshot)), "title excluded from content");
    probeAssertion(digestProjection(projectState(changedTitle)) !== snapshot.state_digest, "title retained by state");
    assertedRuleIds = [
      "M0-PROJECTION-001", "M0-PROJECTION-002", "M0-PROJECTION-003", "M0-PROJECTION-004",
      "M0-PROJECTION-005", "M0-PROJECTION-006", "M0-PROJECTION-007", "M0-PROJECTION-008",
      "M0-STATE-003", "M0-STATE-005", "M0-STATE-006",
    ];
  } else if (probe === "separator") {
    const parsed = parseCliRequest([
      "--json", "evidence", "add", "--dossier", "d", "--operation", "op", "--run", "r",
      "--expected-revision", "0", "--expected-state-digest", `sha256:${"a".repeat(64)}`,
      "--evidence", '{"kind":"file","criterion_ids":["c"],"freshness":"recompute_on_check","limitations":[],"location":{"repository_relative_path":"a\\\\b"}}',
    ]);
    probeAssertion(!parsed.ok && parsed.code === "CASE_E_USAGE", "backslash evidence path rejected at CLI boundary");
    assertedRuleIds = ["M0-STATE-004"];
  } else if (probe === "case-alias") {
    await probeRejects(() => resolveEvidencePath(context.repositoryRoot, "artifacts/evidence.txt"), /CASE_E_EVIDENCE/u);
    assertedRuleIds = ["M0-STATE-004", "M0-CHECK-005"];
  } else if (probe === "symlink") {
    const fake: PathInspectionPort = {
      ...nodePathInspection,
      lstat: async (path) => path.endsWith(`${sep}linked`) ? {
        device: 1n, inode: 2n, isFile: () => false, isDirectory: () => false,
        isSymbolicLink: () => true, isReparsePoint: () => false,
      } : nodePathInspection.lstat(path),
    };
    await probeRejects(() => resolveEvidencePath(context.repositoryRoot, "linked/artifact.txt", fake), /CASE_E_EVIDENCE/u);
    assertedRuleIds = ["M0-STATE-004", "M0-CHECK-005"];
  } else if (probe === "junction") {
    const outside = await mkdtemp(join(tmpdir(), "case-agent-conformance-outside-"));
    const alias = join(context.repositoryRoot, "junction");
    try {
      await writeFile(join(outside, "artifact.txt"), "outside", { flag: "wx" });
      await symlink(outside, alias, "junction");
      await probeRejects(() => resolveEvidencePath(context.repositoryRoot, "junction/artifact.txt"), /CASE_E_EVIDENCE/u);
    } finally {
      try { await unlink(alias); } catch { /* absent link */ }
      await safeRemoveTemporary(outside);
    }
    assertedRuleIds = ["M0-STATE-004", "M0-CHECK-005"];
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
    assertedRuleIds = ["M0-CHECK-004", "M0-RELEASE-005"];
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
    const manifest = {
      protocol: "case-agent",
      protocol_version: "0.1.0-preview",
      schema_dialect: "https://json-schema.org/draft/2020-12/schema",
      repository_id: "repository-a",
      created_at: context.environment.CASE_CLOCK,
    };
    const { protocol_version: _version, ...withoutVersion } = manifest;
    const { schema_dialect: _dialect, ...withoutDialect } = manifest;
    probeAssertion(!context.schemas.validate("manifest", withoutVersion).ok, "protocol version is required separately");
    probeAssertion(!context.schemas.validate("manifest", withoutDialect).ok, "schema dialect is required separately");
    probeThrows(() => compileSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://case-agent.local/conformance/unbundled.schema.json",
      $ref: "https://network.invalid/schema.json",
    }, "unbundled reference"), /could not be compiled offline/u);
    assertedRuleIds = ["M0-SCHEMA-001", "M0-SCHEMA-002", "M0-SCHEMA-003", "M0-STATE-001"];
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
    probeAssertion(!context.schemas.validate("handoff", { ...envelope, status: "offered" }).ok, "stored handoff status is rejected");
    probeAssertion(!context.schemas.validate("handoff", { ...envelope, status_basis: {} }).ok, "stored handoff status basis is rejected");
    assertedRuleIds = ["M0-HANDOFF-001"];
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
    assertedRuleIds = ["M0-CLI-001"];
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
    assertedRuleIds = ["M0-ERROR-001", "M0-ERROR-002"];
  } else if (probe === "offline-boundaries") {
    for (const command of ["update", "telemetry", "uninstall", "purge", "secret-scan", "privacy-certify", "sandbox"]) {
      const parsed = parseCliRequest(["--json", command]);
      probeAssertion(!parsed.ok && parsed.code === "CASE_E_USAGE", `${command} is outside M0`);
    }
    const snapshot = baseProbeSnapshot();
    const localEvidence = snapshot.evidence[0] as unknown as Record<string, unknown>;
    probeAssertion(Object.hasOwn(localEvidence, "artifact_digest") && !Object.hasOwn(localEvidence, "artifact_bytes"), "evidence stores digest and reference, not artifact bytes");
    probeAssertion(CONTROLLED_PROFILE.supported && CONTROLLED_PROFILE.profile === "controlled-test"
      && !CONTROLLED_PROFILE.physical_durability, "test profile makes no durability or production claim");
    probeAssertion(context.schemas.validate("dossier", snapshot).ok, "offline bundled schema registry is active");
    assertedRuleIds = [
      "M0-OFFLINE-001", "M0-OFFLINE-002", "M0-OFFLINE-003", "M0-OFFLINE-004",
      "M0-OFFLINE-005", "M0-OFFLINE-006", "M0-OFFLINE-007",
    ];
  } else if (probe === "posix-unclaimed") {
    const unclassified = nodeAtomicFsPort(context.repositoryRoot);
    probeAssertion(!unclassified.profile.supported, "unclassified production filesystem is not claimed");
    probeAssertion(CONTROLLED_PROFILE.profile === "controlled-test", "test adapter is not POSIX production evidence");
    assertedRuleIds = ["M0-INIT-007", "M0-PLATFORM-001"];
  } else if (probe === "coverage-accounting") {
    const synthetic: Rule[] = [{
      rule_id: "M0-PROBE-001",
      source_section: "probe",
      statement: "synthetic coverage accounting rule",
      requires_positive: true,
      requires_negative: true,
    }];
    probeAssertion(uncoveredRuleIds(synthetic, new Set(["M0-PROBE-001"]), "requires_positive").length === 0, "covered direction clears");
    probeAssertion(uncoveredRuleIds(synthetic, new Set(), "requires_negative")[0] === "M0-PROBE-001", "uncovered direction remains red");
    assertedRuleIds = ["M0-CORPUS-001", "M0-RELEASE-002"];
  } else if (probe === "required-family-contract") {
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
      probeAssertion(isRecord(candidate) && typeof candidate.case_id === "string", "family fixture has a case ID");
      observedCaseIds.add(candidate.case_id);
    }
    const missing = (ids: ReadonlySet<string>): string[] =>
      requiredCaseIds.filter((caseId) => !ids.has(caseId));
    probeAssertion(missing(observedCaseIds).length === 0, "every blocking named family case is present");
    const incomplete = new Set(observedCaseIds);
    incomplete.delete("walking-skeleton-offline");
    probeAssertion(
      JSON.stringify(missing(incomplete)) === '["walking-skeleton-offline"]',
      "a missing required family is detected",
    );
    assertedRuleIds = ["M0-CORPUS-007"];
  } else if (probe === "corpus-red-capability") {
    const fixture = validMinimalCase(context.environment);
    let stdout = "";
    renderJson(success("conformance.probe", "Conformance probe passed", null), { write: (value) => { stdout += value; } });
    const exact: InvocationOutcome[] = [{ processExit: 0, resultCode: "CASE_OK", stdout, stderr: "", assertedRuleIds: ["M0-CORPUS-008"] }];
    probeAssertion(await outcomesMatch(corpusRoot, context.repositoryRoot, fixture, exact), "exact expectation matches");
    probeAssertion(!await outcomesMatch(corpusRoot, context.repositoryRoot, fixture, [{ ...exact[0]!, stdout: `${stdout} ` }]), "stdout mutation is red");
    probeAssertion(await finalTreeMatches(context.repositoryRoot, fixture), "exact empty final tree matches");
    const wrongTree: CorpusCase = {
      ...fixture,
      expected_final_tree: [{ path: "unexpected.txt", presence: "present", sha256: digest(`sha256:${"0".repeat(64)}`) }],
    };
    probeAssertion(!await finalTreeMatches(context.repositoryRoot, wrongTree), "tree mutation is red");
    assertedRuleIds = ["M0-CORPUS-008"];
  } else if (probe === "corpus-contract-positive" || probe === "corpus-contract-negative") {
    const schema = parseStrictJson(await readCorpusFile(corpusRoot, "schema/case.schema.json"));
    const validator = compileSchema(schema, "probe case");
    const valid = validMinimalCase(context.environment);
    probeAssertion(validator(valid), "valid closed fixture");
    assertInvocationStructure(valid);
    assertUniqueOrderedPaths([{ path: "a" }, { path: "b/c" }], "probe ordered paths");
    const referencedFiles = [
      "data/artifact-v1.txt",
      "data/expected/probe-ok.json",
      "data/stdin/confirm-basis.txt",
      "data/views/base.json",
    ];
    for (const reference of referencedFiles) {
      probeAssertion((await readCorpusFile(corpusRoot, reference)).byteLength > 0, `plain in-corpus reference: ${reference}`);
    }
    probeAssertion(
      sha256(await readCorpusFile(corpusRoot, "data/artifact-v1.txt"))
        === "sha256:2d27fbdf4e8ca207afbfa388ca9172fbcc6c70e534af2476b3b704f87debadcf",
      "declared fixture digest is exact",
    );
    probeAssertion(
      context.environment.CASE_CLOCK === "2026-09-04T03:02:01Z"
        && context.environment.CASE_ID_SEED.length > 0
        && context.environment.CASE_NETWORK === "deny"
        && context.environment.LANG === "C"
        && context.environment.LC_ALL === "C"
        && context.environment.TZ === "UTC"
        && CONTROLLED_PROFILE.profile === "controlled-test",
      "execution environment and adapter capabilities are fixed",
    );
    if (probe === "corpus-contract-negative") {
      probeAssertion(!validator({ ...valid, unknown: true }), "unknown root field rejected");
      const badProfile = structuredClone(valid) as unknown as Record<string, unknown>;
      badProfile.applicable_platform_profiles = ["made-up-profile"];
      probeAssertion(!validator(badProfile), "unknown profile rejected");
      const badFault = structuredClone(valid) as CorpusCase;
      (badFault.invocations[0] as unknown as Record<string, unknown>).fault_point = "made-up-fault";
      probeAssertion(!validator(badFault), "unknown fault rejected");
      probeThrows(() => assertSafeFixturePath("../escape", "probe"), /safe relative path/u);
      probeThrows(() => assertUniqueOrderedPaths([{ path: "b" }, { path: "a" }], "probe"), /stable order/u);
      probeThrows(() => assertInvocationStructure({ ...valid, expected: [] }), /counts differ/u);
    }
    assertedRuleIds = ["M0-CORPUS-002", "M0-CORPUS-003", "M0-CORPUS-004", "M0-CORPUS-005", "M0-CORPUS-006"];
  } else if (probe === "platform-boundary") {
    const production = nodeAtomicFsPort(context.repositoryRoot);
    probeAssertion(!production.profile.supported, "unproven production adapter stays unsupported");
    probeAssertion(CONTROLLED_PROFILE.supported && CONTROLLED_PROFILE.profile === "controlled-test", "controlled adapter is explicitly test-only");
    assertedRuleIds = process.platform === "win32"
      ? ["M0-INIT-007", "M0-PLATFORM-002", "M0-PLATFORM-004"]
      : ["M0-INIT-007", "M0-PLATFORM-001", "M0-PLATFORM-004"];
  } else {
    throw new Error(`unknown protocol probe: ${probe}`);
  }
  return { result: success("conformance.probe", "Conformance probe passed", null), assertedRuleIds };
}

async function executeInvocation(
  corpusRoot: string,
  invocation: CorpusInvocation,
  context: CaseContext,
  concurrency: { readonly rank: number; readonly gate: ConcurrencyGate } | null,
): Promise<InvocationOutcome> {
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
      assertedRuleIds: null,
    };
  }
  if (invocation.argv[0] === "@probe") {
    if (invocation.argv.length !== 2 || invocation.argv[1] === undefined) {
      throw new CorpusValidationError("protocol probe argv is malformed");
    }
    const probed = await runProtocolProbe(invocation.argv[1], corpusRoot, context);
    let stdout = "";
    renderJson(probed.result, { write: (value) => { stdout += value; } });
    return {
      processExit: exitCodeFor(probed.result.code),
      resultCode: probed.result.code,
      stdout,
      stderr: "",
      assertedRuleIds: probed.assertedRuleIds,
    };
  }
  const result = await runCli(invocation.argv, await invocationDependencies(corpusRoot, invocation, context, concurrency));
  let stdout = "";
  renderJson(result, { write: (value) => { stdout += value; } });
  return {
    processExit: exitCodeFor(result.code),
    resultCode: result.code,
    stdout,
    stderr: "",
    assertedRuleIds: null,
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
      outcome.processExit !== expected.process_exit
      || outcome.resultCode !== expected.result_code
      || (expected.stderr === "empty" && outcome.stderr !== "")
    ) return false;
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
  return sameMap(actual, expectedPresent);
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
    fixed_environment: context.environment,
    concurrency_group: null,
    fault_point: null,
  };
  const result = await runCli(invocation.argv, await invocationDependencies(corpusRoot, invocation, context, null));
  return result.ok && JSON.stringify(result.data) === JSON.stringify(expected);
}

async function safeRemoveTemporary(path: string): Promise<void> {
  const temporaryRoot = resolve(tmpdir());
  const target = resolve(path);
  if (!isContained(temporaryRoot, target) || target === temporaryRoot) {
    throw new CorpusValidationError("refused unsafe temporary cleanup");
  }
  await rm(target, { recursive: true, force: true });
}

async function executeCase(corpusRoot: string, located: LocatedCase, ports: CorpusPorts): Promise<boolean> {
  const temporary = await mkdtemp(join(tmpdir(), "case-agent-conformance-"));
  const repositoryRoot = join(temporary, "repository");
  let networkCalls = 0;
  const networkResources = new Set(["GETADDRINFOREQWRAP", "GETNAMEINFOREQWRAP", "TCPCONNECTWRAP", "TCPWRAP", "TLSWRAP", "UDPWRAP"]);
  const networkAudit = createHook({
    init: (_asyncId, type) => { if (networkResources.has(type)) networkCalls += 1; },
  });
  try {
    await mkdir(repositoryRoot);
    await mkdir(join(repositoryRoot, ".git"));
    await writeFile(join(repositoryRoot, ".git", "HEAD"), "ref: refs/heads/conformance\n", { flag: "wx" });
    await populateInitialTree(corpusRoot, repositoryRoot, located.fixture);
    const hasExistingDossier = located.fixture.initial_tree.some(({ path }) =>
      /^\.case-agent\/dossiers\/[^/]+\/dossier\.json$/u.test(path));
    const context: CaseContext = {
      repositoryRoot,
      schemas: await SchemaRegistry.load(resolve(dirname(fileURLToPath(import.meta.url)), "../../../schemas")),
      environment: located.fixture.invocations[0]!.fixed_environment,
      dossierCounter: hasExistingDossier ? 1 : 0,
      runCounter: hasExistingDossier ? 1 : 0,
      guardCounter: 0,
    };
    networkAudit.enable();
    const outcomes = await executeInvocations(corpusRoot, located.fixture, context);
    networkAudit.disable();
    for (let index = 0; index < outcomes.length; index += 1) {
      const outcome = outcomes[index]!;
      await ports.onInvocationResult?.(located.fixture.case_id, index, {
        process_exit: outcome.processExit,
        result_code: outcome.resultCode,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
      });
    }
    await ports.onFinalTree?.(
      located.fixture.case_id,
      Object.fromEntries(await collectFiles(repositoryRoot, true)),
    );
    const probeAssertions = new Set(outcomes.flatMap((outcome) => outcome.assertedRuleIds ?? []));
    const containsProbe = outcomes.some((outcome) => outcome.assertedRuleIds !== null);
    if (containsProbe && located.fixture.normative_rule_ids.some((ruleId) => !probeAssertions.has(ruleId))) {
      return false;
    }
    return networkCalls === 0
      && await outcomesMatch(corpusRoot, repositoryRoot, located.fixture, outcomes)
      && await derivedViewMatches(corpusRoot, located.fixture, context)
      && await finalTreeMatches(repositoryRoot, located.fixture);
  } catch {
    return false;
  } finally {
    networkAudit.disable();
    await safeRemoveTemporary(temporary);
  }
}

/** Load, validate, execute, and summarize the frozen conformance corpus. */
export async function runCorpus(corpusRoot: string, ports: CorpusPorts = {}): Promise<CorpusSummary> {
  const root = await realpath(corpusRoot);
  const before = await collectFiles(root, false);
  const { rules, cases } = await loadCorpus(root);
  const positive = new Set<string>();
  const negative = new Set<string>();
  let passed = 0;
  for (const located of cases) {
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
  const uncoveredPositive = uncoveredRuleIds(rules, positive, "requires_positive");
  const uncoveredNegative = uncoveredRuleIds(rules, negative, "requires_negative");
  return {
    total: cases.length,
    passed,
    failed: cases.length - passed,
    uncovered_positive: uncoveredPositive,
    uncovered_negative: uncoveredNegative,
  };
}
