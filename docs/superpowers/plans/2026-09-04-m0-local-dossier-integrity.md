# M0 Local Dossier Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private, offline-capable reference CLI that executes the approved M0 dossier journey and fails closed on stale state, conflicting writers, unsafe evidence, and stale acceptance.

**Architecture:** A TypeScript protocol kernel owns strict parsing, schemas, canonical projections, checks, and transitions. Filesystem and terminal behavior enter through injected ports; a thin CLI translates typed requests into kernel workflows and renders one stable result envelope. Immutable envelopes are created before an atomic snapshot-pointer update, while every governed mutation is serialized by a dossier guard and checked against an exact revision and state digest.

**Tech Stack:** Node.js 24 LTS, TypeScript 7.0.2, Ajv 8.20.0 in Draft 2020-12 mode, `@types/node` 24.10.0, Node built-in test runner, npm lockfile, SHA-256 from `node:crypto`.

**Spec:** `docs/superpowers/specs/2026-09-04-local-dossier-integrity-design.md`

## Global Constraints

- The package remains `private: true`; this plan does not publish to npm or choose a public software license.
- Core commands perform no network access, telemetry, update checks, host discovery, or host configuration writes.
- `case-agent init` may change bytes only under `.case-agent/`.
- M0 supports one machine, a declared local-filesystem profile, conforming writers, and one active writer per dossier.
- M0 does not implement skills, connect helpers, host adapters, MECE workflows, receipts, hooks, MCP, Pi repair, multi-machine coordination, archive/purge, or handoff cancellation.
- All governed instance JSON is UTF-8, duplicate-key-free, number-free I-JSON and validates against bundled Draft 2020-12 schemas before use.
- Canonical digests are `sha256:<lowercase-hex>` over UTF-8 RFC 8785 JCS bytes of a named projection.
- Every existing-dossier mutation binds to `--dossier`, an operation ID, expected revision, and expected state digest.
- Human-mode omitted preconditions are confirmed against one displayed basis and never silently rebound.
- A validator exception, unsupported version, unsafe path, uncertain recovery, or partial publication never becomes a valid result.
- All implementation tasks use red-green-refactor and end in a focused commit; do not combine tasks into one commit.

## File map

```text
package.json                                  package boundary, scripts, pinned dependencies
package-lock.json                             reproducible dependency graph
tsconfig.json                                 strict ESM build configuration
docs/adr/0004-node24-typescript-cli.md         technology decision and trade-off
schemas/*.schema.json                         closed Draft 2020-12 protocol roots
src/protocol/json.ts                          strict governed-instance parser
src/protocol/types.ts                         branded scalars and canonical data shapes
src/protocol/errors.ts                        stable CASE error and exit-code mapping
src/protocol/result.ts                        stable CLI result envelope
src/protocol/schema-registry.ts               offline Ajv schema compilation
src/protocol/canonical.ts                     JCS subset and SHA-256
src/protocol/projections.ts                   named digest projections
src/protocol/checks.ts                        evidence and criterion checks
src/protocol/transitions.ts                   pure transition evaluation
src/storage/paths.ts                          root discovery and safe relative paths
src/storage/store.ts                          governed file loading and topology checks
src/storage/atomic.ts                         platform-profiled create/replace publication
src/storage/guard.ts                          writer and recovery guards
src/workflows/init.ts                         confined namespace initialization
src/workflows/dossier.ts                      dossier creation and current view
src/workflows/evidence.ts                     evidence registration
src/workflows/handoff.ts                      handoff offer and acceptance
src/workflows/submission.ts                   exact submission publication
src/workflows/decision.ts                     recorded human decision publication
src/conformance/runner.ts                     reusable frozen-corpus executor
src/cli/args.ts                               command/request parsing
src/cli/render.ts                             human and JSON result rendering
src/cli/confirm.ts                            interactive basis and decision confirmation
src/cli/main.ts                               thin executable adapter
tests/unit/**                                 pure protocol and adapter tests
tests/integration/**                          real-filesystem command journeys
tests/helpers/**                              deterministic clocks, IDs, ports, and fixtures
conformance/schema/case.schema.json           frozen conformance-case schema
conformance/schema/rules.schema.json          closed normative-rule ledger schema
conformance/rules.json                        stable rule IDs and polarity coverage requirements
conformance/cases/**                          positive and negative protocol vectors
scripts/run-conformance.mjs                   cross-profile corpus runner
evaluation/markdown-baseline/**               preregistered four-case baseline
```

## Specification coverage map

| Approved-spec concern | Owning tasks | Completion evidence |
|---|---:|---|
| Scope, topology, scalar rules | 1–3 | package boundary, closed schemas, strict parser tests |
| Canonical state and six projections | 2–4 | projection mutation matrix and known JCS vectors |
| Repository trust and evidence safety | 5, 7 | confinement, collision, escape, alias, and changed-byte fixtures |
| Writer serialization and recovery | 6 | race and publication-boundary fault tests |
| Handoff | 8 | current, stale, recipient, double-accept, and old-writer fixtures |
| Submission and recorded human decision | 9 | guarded recheck, orphan recovery, exact decision, and stale-acceptance fixtures |
| CLI and bounded rehydration | 10 | black-box JSON/human journeys and explicit-dossier tests |
| Every normative rule and platform profile | 11 | frozen rule ledger plus positive/negative corpus coverage |
| Burden and failure-detection hypothesis | 12 | preregistered B0/M0 records and bounded-claim report |

---

### Task 1: Pin the toolchain and executable shell

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `docs/adr/0004-node24-typescript-cli.md`
- Create: `src/cli/main.ts`
- Create: `tests/smoke/cli.test.ts`

**Interfaces:**
- Consumes: Node.js `>=24 <25` and npm.
- Produces: executable `case-agent`, ESM build under `dist/`, and `npm test` / `npm run check` gates.

- [ ] **Step 1: Add the failing CLI smoke test**

```ts
// tests/smoke/cli.test.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("case-agent reports a stable version envelope", () => {
  const run = spawnSync(process.execPath, ["dist/src/cli/main.js", "--json", "--version"], {
    encoding: "utf8",
  });
  assert.equal(run.status, 0);
  assert.deepEqual(JSON.parse(run.stdout), {
    ok: true,
    command: "version",
    code: "CASE_OK",
    message: "case-agent 0.1.0-preview",
    data: { version: "0.1.0-preview" },
    remediation: null,
  });
  assert.equal(run.stderr, "");
});
```

- [ ] **Step 2: Run the smoke test and observe the missing executable failure**

Run: `npm test`

Expected: non-zero because `package.json`, compiler output, and `dist/src/cli/main.js` do not exist.

- [ ] **Step 3: Add the pinned package and compiler configuration**

```json
{
  "name": "case-agent",
  "version": "0.1.0-preview",
  "private": true,
  "type": "module",
  "bin": { "case-agent": "dist/src/cli/main.js" },
  "files": ["dist/src", "schemas", "README.md"],
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "npm run build && node --test",
    "check": "npm run typecheck && npm test"
  },
  "dependencies": { "ajv": "8.20.0" },
  "devDependencies": {
    "@types/node": "24.10.0",
    "typescript": "7.0.2"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": false
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

Run: `npm install`

Expected: the development dependencies install and `package-lock.json` pins the complete graph. This development-time fetch does not add network behavior to the built CLI.

- [ ] **Step 4: Add the minimum executable and technology ADR**

```ts
#!/usr/bin/env node
// src/cli/main.ts
const envelope = {
  ok: true,
  command: "version",
  code: "CASE_OK",
  message: "case-agent 0.1.0-preview",
  data: { version: "0.1.0-preview" },
  remediation: null,
};

if (process.argv.includes("--version")) {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
  process.exitCode = 0;
} else {
  process.stderr.write("case-agent: command required\n");
  process.exitCode = 2;
}
```

```markdown
---
status: accepted
---

# Use Node.js 24 and TypeScript for the preview CLI

The M0 reference CLI uses Node.js 24 LTS and TypeScript because the target machine already has that LTS runtime, Codex/Claude Code/Pi can invoke the same executable package, and the choice avoids installing a second toolchain before protocol value is demonstrated. The package remains private and uses injected filesystem seams because Node does not itself create stronger cross-platform filesystem guarantees than the declared profile.
```

- [ ] **Step 5: Verify the shell**

Run: `npm run check`

Expected: typecheck succeeds and the smoke test reports one pass, zero failures.

- [ ] **Step 6: Commit the toolchain shell**

```text
git add package.json package-lock.json tsconfig.json docs/adr/0004-node24-typescript-cli.md src/cli/main.ts tests/smoke/cli.test.ts
git commit -m "build: scaffold the M0 reference CLI"
```

### Task 2: Define protocol types, errors, and result envelopes

**Files:**
- Create: `src/protocol/types.ts`
- Create: `src/protocol/errors.ts`
- Create: `src/protocol/result.ts`
- Create: `tests/unit/errors.test.ts`
- Create: `tests/unit/result.test.ts`

**Interfaces:**
- Consumes: no earlier protocol module.
- Produces: `Digest`, `Revision`, `DossierSnapshot`, `CaseError`, `ResultEnvelope<T>`, `exitCodeFor(code)`.

- [ ] **Step 1: Write failing error and envelope tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { exitCodeFor } from "../../src/protocol/errors.js";
import { failure } from "../../src/protocol/result.js";

test("maps conflict errors to process class 30", () => {
  assert.equal(exitCodeFor("CASE_E_CONFLICT"), 30);
});

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
```

- [ ] **Step 2: Run the focused tests and confirm missing exports**

Run: `npm run build`

Run: `node --test --test-name-pattern="conflict errors|failure envelopes"`

Expected: compilation fails because the protocol files do not exist.

- [ ] **Step 3: Implement exact scalar and state types**

```ts
export type Digest = `sha256:${string}`;
export type Revision = `${bigint}`;
export type CriterionVerification = "mechanical" | "recorded_human_review";
export type EvidenceKind = "file" | "command_result" | "external_reference" | "human_observation";

export interface ActiveRun {
  run_id: string;
  actor_id: string;
  started_by_handoff_id: string | null;
}

export interface MutationPrecondition {
  dossier_id: string;
  expected_revision: Revision;
  expected_state_digest: Digest;
  operation_id: string;
}

export type Freshness = "immutable" | "recompute_on_check" | "human_review";
export type EvidenceStatus = "current" | "missing" | "empty" | "changed" | "unsafe" | "human_review_required";
export type CriterionStatus = "mechanically_satisfied" | "human_review_required" | "failed";

export interface Manifest {
  protocol: "case-agent";
  protocol_version: "0.1.0-preview";
  schema_dialect: "https://json-schema.org/draft/2020-12/schema";
  repository_id: string;
  created_at: string;
}

export interface AcceptanceCriterion {
  criterion_id: string;
  statement: string;
  verification: CriterionVerification;
}

export type EvidenceRecord = {
  evidence_id: string;
  criterion_ids: string[];
  captured_at: string;
  freshness: Freshness;
  limitations: string[];
} & (
  | { kind: "file" | "command_result"; location: { repository_relative_path: string }; artifact_digest: Digest; artifact_size: Revision }
  | { kind: "external_reference"; location: { uri: string }; artifact_digest?: never; artifact_size?: never }
  | { kind: "human_observation"; location: { statement: string }; artifact_digest?: never; artifact_size?: never }
);

export interface LastOperation {
  operation_id: string;
  input_digest: Digest;
  basis_revision: Revision;
  resulting_revision: Revision;
}

export interface DossierSnapshot {
  dossier_id: string;
  title: string;
  objective: string;
  scope: { in: string[]; out: string[] };
  constraints: string[];
  acceptance_criteria: AcceptanceCriterion[];
  state_revision: Revision;
  state_digest: Digest;
  last_operation: LastOperation | null;
  active_run: ActiveRun;
  evidence: EvidenceRecord[];
  current_handoff_id: string | null;
  current_submission_id: string | null;
  current_decision_id: string | null;
}

export interface HandoffEnvelope {
  handoff_id: string;
  dossier_id: string;
  from_run_id: string;
  to_actor_id: string;
  basis_revision: Revision;
  basis_state_digest: Digest;
  published_revision: Revision;
  offered_content_digest: Digest;
  created_operation_id: string;
}

export interface SubmissionEnvelope {
  submission_id: string;
  dossier_id: string;
  submitting_run_id: string;
  basis_revision: Revision;
  basis_state_digest: Digest;
  published_revision: Revision;
  content_digest: Digest;
  observed_evidence_digest: Digest;
  checks_digest: Digest;
  created_at: string;
  created_operation_id: string;
  submission_digest: Digest;
}

export interface DecisionEnvelope {
  decision_id: string;
  dossier_id: string;
  submission_id: string;
  submission_digest: Digest;
  decision: "accepted" | "rejected";
  reviewer_id: string;
  criteria_reviewed: string[];
  comment: string;
  decided_at: string;
  created_operation_id: string;
  identity_assurance: "recorded-interactive-claim";
}
```

Add `ObservedEvidenceProjection`, `ChecksProjection`, and `CurrentView` from the exact field lists in spec sections 8.4, 10, and 18. Model the four derived status fields as closed string unions and do not add optional extension maps.

- [ ] **Step 4: Implement stable errors and results**

```ts
export const EXIT_BY_CODE = {
  CASE_OK: 0,
  CASE_E_USAGE: 2,
  CASE_E_NOT_INITIALIZED: 10,
  CASE_E_NAMESPACE_COLLISION: 10,
  CASE_E_UNSUPPORTED_VERSION: 10,
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
} as const;
```

Use a discriminated `ResultEnvelope<T>` with `ok: true` carrying `data: T` and `ok: false` carrying `data: null` plus at most one remediation string.

- [ ] **Step 5: Verify types and mappings**

Run: `npm run check`

Expected: all tests pass and every symbolic error code has one numeric class.

- [ ] **Step 6: Commit the protocol vocabulary**

```text
git add src/protocol/types.ts src/protocol/errors.ts src/protocol/result.ts tests/unit/errors.test.ts tests/unit/result.test.ts
git commit -m "feat: define M0 protocol result types"
```

### Task 3: Enforce strict governed JSON and bundled schemas

**Files:**
- Create: `src/protocol/json.ts`
- Create: `src/protocol/schema-registry.ts`
- Create: `schemas/definitions.schema.json`
- Create: `schemas/manifest.schema.json`
- Create: `schemas/dossier.schema.json`
- Create: `schemas/handoff.schema.json`
- Create: `schemas/submission.schema.json`
- Create: `schemas/decision.schema.json`
- Create: `schemas/result.schema.json`
- Create: `schemas/observed-evidence.schema.json`
- Create: `schemas/checks.schema.json`
- Create: `tests/unit/json.test.ts`
- Create: `tests/unit/schemas.test.ts`

**Interfaces:**
- Consumes: protocol interfaces from Task 2.
- Produces: `parseGovernedJson(bytes)`, `SchemaRegistry.validate(kind, value)`, and offline root schemas.

- [ ] **Step 1: Write strict-parser negative tests**

```ts
test("rejects duplicate decoded member names", () => {
  assert.throws(() => parseGovernedJson(Buffer.from('{"a":true,"\\u0061":false}')), /CASE_E_PARSE/);
});

test("rejects numbers and UTF-8 BOM", () => {
  assert.throws(() => parseGovernedJson(Buffer.from('{"revision":1}')), /CASE_E_PARSE/);
  assert.throws(() => parseGovernedJson(Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), /CASE_E_PARSE/);
});

test("accepts nested number-free JSON", () => {
  assert.deepEqual(parseGovernedJson(Buffer.from('{"a":[true,null,{"b":"x"}]}')), {
    a: [true, null, { b: "x" }],
  });
});
```

- [ ] **Step 2: Run the parser tests and confirm red**

Run: `npm run build`

Run: `node --test --test-name-pattern="duplicate decoded|numbers and UTF-8|number-free"`

Expected: compilation fails because `parseGovernedJson` is absent.

- [ ] **Step 3: Implement a number-free recursive-descent parser**

```ts
export type JsonValue = null | boolean | string | JsonValue[] | { [key: string]: JsonValue };

export function parseGovernedJson(bytes: Uint8Array): JsonValue {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw caseParse("bom");
  const parser = new StrictParser(text);
  const value = parser.parseValue();
  parser.requireEnd();
  return value;
}
```

Implement `StrictParser` with explicit object, array, string, literal, and whitespace routines. Object parsing stores decoded keys in a `Set` before accepting each value. String parsing rejects unpaired surrogates and protocol-forbidden noncharacters after escape decoding. `-` and ASCII digits at value start immediately raise `CASE_E_PARSE`; comments and trailing commas are never accepted.

- [ ] **Step 4: Add failing schema-root tests**

```ts
test("all bundled roots compile offline as Draft 2020-12", async () => {
  const registry = await SchemaRegistry.load(schemaDirectory);
  for (const kind of ["manifest", "dossier", "handoff", "submission", "decision", "result", "observed-evidence", "checks"] as const) {
    assert.equal(registry.has(kind), true);
  }
});

test("dossier rejects an unknown property", async () => {
  const result = registry.validate("dossier", { ...validDossier, surprise: true });
  assert.equal(result.ok, false);
  assert.equal(result.code, "CASE_E_SCHEMA");
});
```

- [ ] **Step 5: Add closed schemas and offline registry**

Each root declares:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://case-agent.dev/schema/0.1.0-preview/<kind>.schema.json",
  "type": "object",
  "additionalProperties": false
}
```

Fill `properties` and `required` from Task 2 types and the approved spec. Use decimal-string and digest patterns from `definitions.schema.json`; never rely on `format` for timestamp validity. Instantiate `Ajv2020` with `{ strict: true, allErrors: true, validateFormats: false, loadSchema: undefined }`, add every bundled schema from disk, and expose only stable CASE diagnostics rather than raw Ajv text.

The closed roots must require these exact top-level fields:

| Root | Required fields |
|---|---|
| manifest | `protocol`, `protocol_version`, `schema_dialect`, `repository_id`, `created_at` |
| dossier | all fields of `DossierSnapshot`; nullable values remain required keys |
| handoff | all fields of `HandoffEnvelope` |
| submission | all fields of `SubmissionEnvelope` |
| decision | all fields of `DecisionEnvelope` |
| result | `ok`, `command`, `code`, `message`, `data`, `remediation` with success/failure branches |
| observed-evidence | the exact projection fields in spec 8.4 |
| checks | the exact projection fields in spec 8.4 |

Use anchored patterns `^(0|[1-9][0-9]*)$` for decimal strings and `^sha256:[0-9a-f]{64}$` for digests. Validate RFC 3339 UTC timestamps with explicit parser code after schema validation.

- [ ] **Step 6: Verify strict parsing and schemas**

Run: `npm run check`

Expected: duplicate keys, numbers, BOM, unknown fields, and unknown major versions are red; every bundled root compiles without network access.

- [ ] **Step 7: Commit strict JSON and schema roots**

```text
git add src/protocol/json.ts src/protocol/schema-registry.ts schemas tests/unit/json.test.ts tests/unit/schemas.test.ts
git commit -m "feat: validate strict M0 JSON schemas"
```

### Task 4: Implement canonical projections and digests

**Files:**
- Create: `src/protocol/canonical.ts`
- Create: `src/protocol/projections.ts`
- Create: `tests/unit/canonical.test.ts`
- Create: `tests/unit/projections.test.ts`

**Interfaces:**
- Consumes: validated number-free protocol values and Task 2 types.
- Produces: `canonicalize(value)`, `digestProjection(value)`, `projectState`, `projectContent`, `projectObservedEvidence`, `projectChecks`, `projectSubmission`.

- [ ] **Step 1: Write JCS subset and Unicode-order tests**

```ts
test("canonicalizes object keys by UTF-16 code units", () => {
  assert.equal(canonicalize({ "😀": "astral", "\ufffd": "bmp", a: true }), '{"a":true,"😀":"astral","�":"bmp"}');
});

test("does not normalize Unicode", () => {
  assert.notEqual(digestProjection("é"), digestProjection("e\u0301"));
});
```

- [ ] **Step 2: Run canonical tests and confirm missing functions**

Run: `npm run build`

Run: `node --test --test-name-pattern="canonicalizes object|does not normalize"`

Expected: compilation fails because canonicalization is absent.

- [ ] **Step 3: Implement number-free JCS and SHA-256**

```ts
export function canonicalize(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort(compareUtf16CodeUnits);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key]!)}`).join(",")}}`;
}

export function digestProjection(value: JsonValue): Digest {
  return `sha256:${createHash("sha256").update(canonicalize(value), "utf8").digest("hex")}`;
}
```

Implement `compareUtf16CodeUnits` without locale APIs. Reject any runtime number defensively even though the strict parser already rejects governed numbers.

- [ ] **Step 4: Write projection inclusion/exclusion tests**

```ts
test("content digest ignores captured_at but includes declared artifact digest", () => {
  const first = projectContent(validDossier);
  const changedTime = projectContent(withEvidence(validDossier, { captured_at: "2099-01-01T00:00:00Z" }));
  const changedArtifact = projectContent(withEvidence(validDossier, { artifact_digest: otherDigest }));
  assert.deepEqual(first, changedTime);
  assert.notDeepEqual(first, changedArtifact);
});

test("checks digest survives a human decision pointer update", () => {
  assert.equal(digestProjection(projectChecks(beforeDecision)), digestProjection(projectChecks(afterDecision)));
});
```

- [ ] **Step 5: Implement all six named projections as explicit object literals**

Do not spread snapshot or envelope objects. Each function returns an object literal listing the spec fields in the spec order; evidence and criterion arrays preserve dossier order, while stable code arrays use ASCII lexical sorting. Add compile-time `satisfies JsonValue` checks so a new state field cannot enter a projection accidentally.

- [ ] **Step 6: Run projection mutation tests**

Run: `npm run check`

Expected: every required included-field mutation changes the intended digest; every excluded-field mutation leaves it unchanged; decision pointer updates do not stale their submission.

- [ ] **Step 7: Commit canonical digests**

```text
git add src/protocol/canonical.ts src/protocol/projections.ts tests/unit/canonical.test.ts tests/unit/projections.test.ts
git commit -m "feat: add canonical M0 digest projections"
```

### Task 5: Confine repository initialization and evidence paths

**Files:**
- Create: `src/storage/paths.ts`
- Create: `src/storage/store.ts`
- Create: `src/workflows/init.ts`
- Create: `tests/integration/init.test.ts`
- Create: `tests/unit/paths.test.ts`

**Interfaces:**
- Consumes: strict parser, manifest schema, and result envelopes.
- Produces: `discoverRepositoryRoot(start)`, `resolveEvidencePath(root, lexicalPath)`, `initRepository(request, ports)`, `CaseStore.loadDossier(id)`.

- [ ] **Step 1: Write failing confinement and collision tests**

```ts
test("init changes no byte outside .case-agent", async () => {
  const before = await snapshotTree(repo);
  const result = await initRepository({ start_directory: nested, operation_id: "op-init" }, ports);
  const after = await snapshotTree(repo);
  assert.equal(result.ok, true);
  assert.deepEqual(withoutCaseAgent(before), withoutCaseAgent(after));
});

test("init rejects a foreign .case-agent directory before writing", async () => {
  await mkdir(join(repo, ".case-agent"));
  await writeFile(join(repo, ".case-agent", "foreign.txt"), "mine");
  const result = await initRepository({ start_directory: repo, operation_id: "op-init" }, ports);
  assert.equal(result.code, "CASE_E_NAMESPACE_COLLISION");
  assert.equal(await readFile(join(repo, ".case-agent", "foreign.txt"), "utf8"), "mine");
});
```

- [ ] **Step 2: Run init tests and confirm red**

Run: `npm run build`

Run: `node --test --test-name-pattern="init changes|foreign .case-agent"`

Expected: compilation fails because storage and init workflow are absent.

- [ ] **Step 3: Implement root discovery and confined init**

Walk parents from `start_directory` until the owning `.git` work tree marker is found; never cross the volume root. Resolve and display the root before mutation. Create `.case-agent` through a sibling temporary directory, write and validate `manifest.json`, create `dossiers/` and `locks/`, then rename the complete directory into place. Existing compatible manifests return the prior success; partial, foreign, symlinked, junctioned, or unsupported-major namespaces fail before writes.

```ts
export function discoverRepositoryRoot(start: string, fs: PathInspectionPort): Promise<string>;
export function resolveEvidencePath(root: string, lexicalPath: string, fs: PathInspectionPort): Promise<OpenedEvidence>;
export function initRepository(request: InitRequest, ports: InitPorts): Promise<ResultEnvelope<InitResult>>;
```

- [ ] **Step 4: Write failing canonical path tests**

```ts
for (const path of ["/abs", "C:/abs", "\\\\server\\share", "a\\b", "a//b", "a/./b", "a/../b"]) {
  test(`rejects unsafe lexical path ${path}`, async () => {
    await assert.rejects(resolveEvidencePath(repo, path), /CASE_E_EVIDENCE/);
  });
}
```

- [ ] **Step 5: Implement lexical and filesystem path validation**

Split only on `/`; reject forbidden forms before touching the filesystem. Resolve one segment at a time with `lstat`, reject links/reparse points, compare the requested segment with the filesystem-returned canonical segment without case folding, open the final regular file, then prove the final resolved path remains under the bound root. Return the opened handle plus canonical repository-relative path so validation does not reopen through a different name.

- [ ] **Step 6: Verify repository and path boundaries**

Run: `npm run check`

Expected: nested-root init is deterministic, collision fixtures are unchanged, and all escape/alias fixtures fail closed.

- [ ] **Step 7: Commit repository confinement**

```text
git add src/storage/paths.ts src/storage/store.ts src/workflows/init.ts tests/integration/init.test.ts tests/unit/paths.test.ts
git commit -m "feat: confine repository initialization"
```

### Task 6: Serialize and publish governed mutations

**Files:**
- Create: `src/storage/atomic.ts`
- Create: `src/storage/guard.ts`
- Create: `tests/integration/atomic.test.ts`
- Create: `tests/integration/guard.test.ts`
- Create: `tests/helpers/fault-port.ts`

**Interfaces:**
- Consumes: `CaseStore`, `MutationPrecondition`, projection digests, injected filesystem/process ports.
- Produces: `commitSnapshotMutation`, `commitEnvelopeMutation`, `acquireWriterGuard`, `recoverWriterGuard`.

- [ ] **Step 1: Write failing concurrent-writer and stale-precondition tests**

```ts
test("exactly one conforming writer commits from one basis", async () => {
  const [a, b] = await Promise.all([
    mutateSameBasis(storeA, basis, "op-a"),
    mutateSameBasis(storeB, basis, "op-b"),
  ]);
  assert.equal([a, b].filter((x) => x.ok).length, 1);
  assert.ok(["CASE_E_BUSY", "CASE_E_CONFLICT"].includes([a, b].find((x) => !x.ok)!.code));
});
```

- [ ] **Step 2: Run writer tests and confirm red**

Run: `npm run build`

Run: `node --test --test-name-pattern="exactly one conforming"`

Expected: compilation fails because guard publication is absent.

- [ ] **Step 3: Implement exclusive guards and precondition ordering**

Create `locks/<dossier>.lock` with `open(..., "wx")`. Store guard ID, basis revision/digest, PID, process-start evidence, and creation time. After acquisition, reload and validate the snapshot, compare the exact basis, and only then call the mutation builder. A held lock returns `CASE_E_BUSY`; a possibly stale lock returns `CASE_E_RECOVERY_REQUIRED` rather than automatic takeover.

```ts
export interface MutationPorts { fs: AtomicFsPort; processIdentity: ProcessIdentityPort; clock: ClockPort; ids: IdPort }
export function acquireWriterGuard(store: CaseStore, precondition: MutationPrecondition, ports: MutationPorts): Promise<WriterGuard>;
export function commitSnapshotMutation<T>(guard: WriterGuard, build: (basis: DossierSnapshot) => MutationProduct<T>): Promise<ResultEnvelope<T>>;
```

- [ ] **Step 4: Implement platform-profiled atomic publication**

Write the complete snapshot to a same-directory uniquely named temporary file, flush and close, validate it, then publish through `AtomicFsPort.replaceCurrent(temp, target)`. The POSIX implementation uses same-directory `rename`; the Windows implementation must use one documented `ReplaceFile`-equivalent primitive rather than a delete-then-rename sequence. Reopen and validate the target before releasing the guard. The Windows adapter treats sharing violations as bounded retryable observations and verifies the target after any replace failure. The POSIX adapter distinguishes process-crash safety from physical durability. Never cross volumes.

```ts
export interface AtomicFsPort {
  createOnce(path: string, bytes: Uint8Array): Promise<void>;
  replaceCurrent(tempPath: string, targetPath: string): Promise<void>;
  flushFile(path: string): Promise<void>;
  verifyProcessTerminated(identity: ProcessIdentity): Promise<"terminated" | "live" | "unknown">;
}
```

- [ ] **Step 5: Add boundary fault injection tests**

```ts
for (const point of ["after_temp_open", "after_temp_flush", "after_envelope_create", "after_snapshot_replace"] as const) {
  test(`fails closed at ${point}`, async () => {
    const result = await runWithInjectedFault(point);
    assert.equal(result.ok, false);
    assert.ok(["CASE_E_INTERNAL", "CASE_E_RECOVERY_REQUIRED"].includes(result.code));
    assert.equal(await acceptsPartialSnapshot(repo), false);
  });
}
```

- [ ] **Step 6: Implement immediate idempotency and explicit recovery**

Store the last operation tuple and input digest in the resulting snapshot. Identical immediate retries return the prior success; older-basis replay returns conflict. Recovery first acquires a separate exclusive recovery guard, verifies owner termination through the profile adapter, quarantines the stale lock, publishes a no-op revision, and releases recovery last. An inconclusive process check refuses recovery.

- [ ] **Step 7: Verify mutation safety**

Run: `npm run check`

Expected: race test has one success, every injected interruption leaves no accepted partial state, and uncertain recovery fails closed.

- [ ] **Step 8: Commit guarded publication**

```text
git add src/storage/atomic.ts src/storage/guard.ts tests/integration/atomic.test.ts tests/integration/guard.test.ts tests/helpers/fault-port.ts
git commit -m "feat: serialize governed dossier mutations"
```

### Task 7: Create dossiers, register evidence, check, and show

**Files:**
- Create: `src/protocol/checks.ts`
- Create: `src/protocol/transitions.ts`
- Create: `src/workflows/dossier.ts`
- Create: `src/workflows/evidence.ts`
- Create: `tests/unit/checks.test.ts`
- Create: `tests/integration/dossier.test.ts`
- Create: `tests/integration/evidence.test.ts`

**Interfaces:**
- Consumes: schema registry, projections, safe store, guarded mutation.
- Produces: `createDossier`, `addEvidence`, `checkDossier`, `showDossier`, `evaluateTransition`.

- [ ] **Step 1: Write failing dossier creation and explicit-address tests**

```ts
test("create fixes the brief and initial active run", async () => {
  const result = await createDossier(validCreateRequest, ports);
  assert.equal(result.ok, true);
  assert.equal(result.data.snapshot.state_revision, "0");
  assert.deepEqual(result.data.snapshot.active_run, {
    run_id: "run-a",
    actor_id: "actor-a",
    started_by_handoff_id: null,
  });
});

test("show never guesses a dossier", async () => {
  const result = await showDossier({ dossier_id: "" }, ports);
  assert.equal(result.code, "CASE_E_USAGE");
});
```

- [ ] **Step 2: Implement dossier creation and immutable brief fields**

Validate the complete create request before writing. Generate fixed IDs/time through injected ports, create revision `"0"`, calculate the stored state digest, and publish one complete dossier directory. Expose no M0 transition that edits title, objective, scope, constraints, or criteria.

```ts
export function createDossier(request: CreateDossierRequest, ports: WorkflowPorts): Promise<ResultEnvelope<CreateDossierResult>>;
export function showDossier(request: { dossier_id: string }, ports: ReadPorts): Promise<ResultEnvelope<CurrentView>>;
```

- [ ] **Step 3: Write failing criterion/evidence tests**

```ts
test("mechanical criterion needs one current mechanical evidence", async () => {
  const report = await checkDossier(dossierWithOnlyHumanObservationForMechanicalCriterion, ports);
  assert.equal(report.verdict, "failed");
  assert.equal(report.criterion_results[0]?.status, "failed");
});

test("recorded human criterion remains human_review_required", async () => {
  const report = await checkDossier(dossierWithHumanReviewEvidence, ports);
  assert.equal(report.verdict, "passed");
  assert.equal(report.criterion_results[0]?.status, "human_review_required");
});
```

- [ ] **Step 4: Implement evidence registration and deterministic checks**

`addEvidence` validates the tagged location, opens local evidence through the safe path resolver, captures digest and decimal-string size, links only existing criterion IDs, then commits the evidence record without clearing prior submission/decision pointers. `checkDossier` is read-only and constructs observed-evidence and checks projections using only stable codes and protocol ordering.

```ts
export function addEvidence(request: AddEvidenceRequest & MutationPrecondition, ports: WorkflowPorts): Promise<ResultEnvelope<AddEvidenceResult>>;
export function checkDossier(request: { dossier_id: string }, ports: ReadPorts): Promise<ResultEnvelope<ChecksProjection>>;
export function evaluateTransition(snapshot: DossierSnapshot, proposal: TransitionProposal): TransitionEvaluation;
```

- [ ] **Step 5: Implement the bounded current view**

Return objective, active run, full revision/digest in machine data, criterion status, evidence gaps, review/acceptance/handoff status, warnings, and one `next_action` code. The default human rendering abbreviates the digest only for display; confirmation paths use the complete value from the same structured view.

- [ ] **Step 6: Verify the local dossier path**

Run: `npm run check`

Expected: create/add/check/show integration passes; changed, missing, empty, outside-root, link, and wrong-criterion evidence fixtures fail with stable codes.

- [ ] **Step 7: Commit dossier integrity workflows**

```text
git add src/protocol/checks.ts src/protocol/transitions.ts src/workflows/dossier.ts src/workflows/evidence.ts tests/unit/checks.test.ts tests/integration/dossier.test.ts tests/integration/evidence.test.ts
git commit -m "feat: validate local dossier evidence"
```

### Task 8: Transfer the active writer through handoff

**Files:**
- Create: `src/workflows/handoff.ts`
- Create: `tests/integration/handoff.test.ts`

**Interfaces:**
- Consumes: guarded envelope mutation, dossier state, canonical digests.
- Produces: `offerHandoff(request, ports)` and `acceptHandoff(request, ports)`.

- [ ] **Step 1: Write the failing successful handoff journey**

```ts
test("recipient accepts only the still-current offer", async () => {
  const offered = await offerHandoff(offerFromRunA, ports);
  const accepted = await acceptHandoff({ ...acceptAsB, expected_revision: offered.data.published_revision }, ports);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.data.active_run.actor_id, "actor-b");
  assert.equal(accepted.data.active_run.started_by_handoff_id, offered.data.handoff_id);
});
```

- [ ] **Step 2: Write stale, wrong-recipient, and double-accept tests**

```ts
test("intervening governed work stales an unaccepted offer", async () => {
  const offered = await offerHandoff(offerFromRunA, ports);
  await addEvidence(additionalEvidenceFromRunA, ports);
  const accepted = await acceptHandoff(acceptOffer(offered, "actor-b"), ports);
  assert.equal(accepted.code, "CASE_E_CONFLICT");
});
```

Add cases for the wrong actor label, inactive `from_run_id`, a second acceptance, and mutation by run A after successful acceptance.

- [ ] **Step 3: Implement offer publication**

Under the writer guard, verify the active run and basis, build an operation-derived immutable offer with basis revision/digest and deterministic published revision, create it exclusively, and publish the snapshot pointer. The offer itself does not transfer responsibility.

```ts
export function offerHandoff(request: OfferHandoffRequest & MutationPrecondition, ports: WorkflowPorts): Promise<ResultEnvelope<OfferHandoffResult>>;
```

- [ ] **Step 4: Implement terminal acceptance**

Require exact published revision, current handoff ID, offered content digest, active from-run, and recipient label. Create the new run and set `started_by_handoff_id` in one snapshot mutation. Derive accepted status from all three canonical links; later ordinary work does not retroactively stale the accepted handoff.

```ts
export function acceptHandoff(request: AcceptHandoffRequest & MutationPrecondition, ports: WorkflowPorts): Promise<ResultEnvelope<AcceptHandoffResult>>;
```

- [ ] **Step 5: Verify handoff invariants**

Run: `npm run build`

Run: `node --test --test-name-pattern="handoff|offer|recipient|old writer"`

Expected: success journey passes and all stale/actor/double-write paths fail with conflict, actor, or transition codes.

- [ ] **Step 6: Commit handoff semantics**

```text
git add src/workflows/handoff.ts tests/integration/handoff.test.ts
git commit -m "feat: transfer active dossier writers"
```

### Task 9: Submit exact work and record a human decision

**Files:**
- Create: `src/workflows/submission.ts`
- Create: `src/workflows/decision.ts`
- Create: `src/cli/confirm.ts`
- Create: `tests/integration/submission.test.ts`
- Create: `tests/integration/decision.test.ts`
- Create: `tests/helpers/confirmation-port.ts`

**Interfaces:**
- Consumes: current checks, canonical submission projection, envelope publication, terminal confirmation port.
- Produces: `createSubmission`, `recordDecision`, `ConfirmationPort.confirmBasis`, `ConfirmationPort.confirmDecision`.

- [ ] **Step 1: Write failing submission readiness tests**

```ts
test("submission reruns checks under the writer guard", async () => {
  await mutateArtifactAfterDisplayedCheck(repo);
  const result = await createSubmission(submissionFromDisplayedBasis, ports);
  assert.equal(result.code, "CASE_E_EVIDENCE");
  assert.equal(await countSubmissionEnvelopes(repo), 0);
});
```

Add cases for inactive run, failed checks, unaccepted current handoff, and an orphan envelope retry with fixed ID/time.

- [ ] **Step 2: Implement submission publication**

Acquire the writer guard, reload the exact basis, rerun current checks, and build the immutable envelope with content, observed-evidence, checks, and submission digests. Create it before publishing the snapshot pointer. A new submission replaces `current_submission_id` and clears `current_decision_id`; an ordinary content mutation retains old pointers so they derive stale.

```ts
export function createSubmission(request: CreateSubmissionRequest & MutationPrecondition, ports: WorkflowPorts): Promise<ResultEnvelope<CreateSubmissionResult>>;
```

- [ ] **Step 3: Write failing human-decision tests**

```ts
test("decision can target only the current submission", async () => {
  const result = await recordDecision(decisionForOlderSubmission, interactivePorts);
  assert.equal(result.code, "CASE_E_CONFLICT");
});

test("orphan decision retry requires confirmation again", async () => {
  const result = await recordDecision(orphanDecisionRetry, nonInteractivePorts);
  assert.equal(result.code, "CASE_E_HUMAN_CONFIRMATION");
});
```

- [ ] **Step 4: Implement recorded decision publication**

Require a TTY-backed `ConfirmationPort`, exact `current_submission_id` and digest, and `criteria_reviewed` equal to all criterion IDs in canonical order. Display the exact submission and identity limitation, require the fixed confirmation phrase, create the immutable decision, then publish the pointer. Orphan recovery repeats confirmation. Never expose `--yes`.

```ts
export interface ConfirmationPort {
  confirmBasis(view: CurrentView, transition: ProposedTransition): Promise<boolean>;
  confirmDecision(review: ExactSubmissionReview, phrase: string): Promise<boolean>;
}
export function recordDecision(request: DecisionRequest & MutationPrecondition, ports: DecisionPorts): Promise<ResultEnvelope<DecisionResult>>;
```

- [ ] **Step 5: Prove stale acceptance**

```ts
test("accepted work becomes stale after covered artifact bytes change", async () => {
  await recordDecision(validAcceptance, interactivePorts);
  await writeFile(coveredArtifact, "changed");
  const view = await showDossier({ dossier_id }, ports);
  assert.equal(view.data.acceptance, "stale");
  assert.equal(view.data.review, "working");
});
```

Also prove that recording the decision itself does not stale its submission and that a new submission clears the old decision pointer.

- [ ] **Step 6: Verify submission and decision journeys**

Run: `npm run check`

Expected: exact submission, interactive accept/reject, orphan authorization, and stale-acceptance tests pass.

- [ ] **Step 7: Commit review semantics**

```text
git add src/workflows/submission.ts src/workflows/decision.ts src/cli/confirm.ts tests/integration/submission.test.ts tests/integration/decision.test.ts tests/helpers/confirmation-port.ts
git commit -m "feat: bind human decisions to submissions"
```

### Task 10: Expose the complete thin CLI

**Files:**
- Create: `src/cli/args.ts`
- Create: `src/cli/render.ts`
- Modify: `src/cli/main.ts`
- Create: `tests/integration/cli.test.ts`

**Interfaces:**
- Consumes: every workflow and stable result/error mapping.
- Produces: the exact M0 command surface in spec section 16.

- [ ] **Step 1: Write failing JSON-mode process tests**

```ts
test("JSON mode emits one envelope and no required stderr data", () => {
  const run = runCli(["--json", "dossier", "show", "--dossier", dossierId], repo);
  assert.equal(run.status, 0);
  assert.equal(run.stderr, "");
  assert.equal(run.stdout.trim().split("\n").length, 1);
  assert.equal(JSON.parse(run.stdout).command, "dossier.show");
});

test("dossier-scoped commands reject a missing dossier ID", () => {
  const run = runCli(["--json", "dossier", "show"], repo);
  assert.equal(run.status, 2);
  assert.equal(JSON.parse(run.stdout).code, "CASE_E_USAGE");
});
```

- [ ] **Step 2: Implement typed argument parsing**

Use Node `parseArgs` separately for the global mode and each explicit command. Convert parsed input into discriminated request objects; do not pass raw option maps into workflows. In machine mode, require full preconditions. In human mode, call the confirmation port with the exact same-invocation basis before mutation.

```ts
export type CliRequest = InitRequest | CreateDossierRequest | ShowRequest | CheckRequest | AddEvidenceRequest | CreateSubmissionRequest | DecisionRequest | OfferHandoffRequest | AcceptHandoffRequest | RecoverGuardRequest;
export function parseCliRequest(argv: readonly string[]): ResultEnvelope<CliRequest>;
```

- [ ] **Step 3: Implement one-result rendering**

`renderJson` writes exactly one compact envelope plus newline to stdout and no machine-required stderr. `renderHuman` uses the same envelope, keeps the default current view bounded, and prints the one remediation only for failures. Messages may vary by locale later; command, code, data keys, and exit mapping do not.

- [ ] **Step 4: Wire all approved commands**

Wire only: `init`, `dossier create/show/check`, `evidence add`, `submission create`, `decision accept/reject`, `handoff offer/accept`, and `guard recover`. Confirm that archive, abandon, purge, connect, cancel, plugin, skill, MCP, and host commands produce `CASE_E_USAGE`.

- [ ] **Step 5: Run the black-box CLI journey**

Run: `npm run check`

Expected: the process-level init → create → evidence → handoff → submit → accept → artifact change → stale journey passes with stable JSON and exit codes.

- [ ] **Step 6: Commit the executable interface**

```text
git add src/cli/args.ts src/cli/render.ts src/cli/main.ts tests/integration/cli.test.ts
git commit -m "feat: expose the M0 case-agent CLI"
```

### Task 11: Build the frozen conformance corpus

**Files:**
- Create: `conformance/schema/case.schema.json`
- Create: `conformance/schema/rules.schema.json`
- Create: `conformance/rules.json`
- Create: `conformance/cases/positive/walking-skeleton/**`
- Create: `conformance/cases/negative/**`
- Create: `src/conformance/runner.ts`
- Create: `scripts/run-conformance.mjs`
- Create: `tests/conformance/corpus.test.ts`

**Interfaces:**
- Consumes: built CLI, frozen fixture contract, deterministic test ports.
- Produces: `npm run conformance`, per-rule positive/negative vectors, machine-readable summary.

- [ ] **Step 1: Freeze the normative-rule ledger, case schema, and one red case**

Assign stable IDs to every normative requirement in spec sections 6–24 in `conformance/rules.json`. Each closed ledger entry contains `rule_id`, `source_section`, `statement`, `requires_positive`, and `requires_negative`; no implementation result may rewrite the statement. Encode every case field from spec section 22.1 with `additionalProperties: false`. Add a negative `namespace-collision` case with fixed input tree, argv, expected exit `10`, result code, exact stdout envelope, empty stderr, and unchanged final-tree digests.

```json
{
  "rule_id": "M0-INIT-002",
  "source_section": "19",
  "statement": "Foreign or partial .case-agent content fails before writes.",
  "requires_positive": true,
  "requires_negative": true
}
```

- [ ] **Step 2: Add a failing corpus-runner test**

```ts
test("every normative rule has positive and negative coverage", async () => {
  const summary = await runCorpus(corpusRoot);
  assert.deepEqual(summary.uncovered_positive, []);
  assert.deepEqual(summary.uncovered_negative, []);
  assert.equal(summary.failed, 0);
});
```

- [ ] **Step 3: Implement the deterministic runner**

The runner validates each case schema, copies `initial_tree` into a fresh temporary repository, fixes environment/IDs/time, executes sequential or concurrent invocations, injects only named fault points, validates process results, hashes the final tree, and compares the derived view. It emits `{ total, passed, failed, uncovered_positive, uncovered_negative }` as JSON and exits non-zero on any mismatch.

```ts
export interface CorpusSummary {
  total: number;
  passed: number;
  failed: number;
  uncovered_positive: string[];
  uncovered_negative: string[];
}
export function runCorpus(corpusRoot: string, ports?: CorpusPorts): Promise<CorpusSummary>;
```

`scripts/run-conformance.mjs` imports the built `dist/src/conformance/runner.js`; the test imports the TypeScript module. There is one runner implementation, not a script-only duplicate.

- [ ] **Step 4: Add positive and negative families**

Create at least these named cases, then add any cases required to eliminate uncovered ledger IDs:

| Family | Required case IDs | Principal expected result |
|---|---|---|
| Initialization | `init-clean`, `init-foreign`, `init-partial` | success / `CASE_E_NAMESPACE_COLLISION` |
| Strict JSON/schema/JCS | `json-duplicate`, `json-number`, `json-bom`, `schema-unknown`, `jcs-unicode` | `CASE_E_PARSE` / `CASE_E_SCHEMA` / exact digest |
| Concurrent writers | `writer-same-basis` | exactly one success; loser busy or conflict |
| Idempotency | `retry-immediate`, `operation-reuse-different-input`, `retry-old-basis` | prior success / invariant / conflict |
| Publication faults | one case per named fault point | internal or recovery-required; no accepted partial state |
| Guard recovery | `guard-live`, `guard-dead`, `guard-unknown` | busy / success / recovery-required |
| Evidence | `evidence-missing`, `empty`, `changed`, `external`, `symlink`, `junction`, `alias` | stable evidence/check outcome |
| Handoff | `handoff-stale`, `wrong-recipient`, `double-accept`, `replacement`, `old-writer` | conflict, actor, or transition |
| Submission | `submit-failed-check`, `submit-open-handoff`, `submit-inactive-run` | evidence, transition, or actor |
| Decision | `decision-no-tty`, `decision-old-submission`, `acceptance-stale` | human-confirmation / conflict / stale view |
| Version/internal | `version-newer`, `state-unknown`, `critical-field-unknown`, `validator-throws` | unsupported/schema/internal |
| Rehydration | `show-context-loss` | exact bounded derived view |
| Platform text/path | `crlf`, `key-order`, `unicode-nfd`, `case-alias`, `separator` | profile-specific exact result |
| Offline | `walking-skeleton-offline` | success with zero network calls |

Each case lists its normative rule IDs, exact process result, final-tree digest set, and derived view. Coverage is computed from the ledger, not from the family count.

- [ ] **Step 5: Add scripts and run the corpus**

Add to `package.json`:

```json
{
  "scripts": {
    "conformance": "npm run build && node scripts/run-conformance.mjs",
    "check": "npm run typecheck && npm test && npm run conformance"
  }
}
```

Run: `npm run check`

Expected: all tests and corpus cases pass; uncovered lists are empty.

- [ ] **Step 6: Commit the red-capable oracle**

```text
git add conformance src/conformance/runner.ts scripts/run-conformance.mjs tests/conformance/corpus.test.ts package.json package-lock.json
git commit -m "test: add the M0 conformance corpus"
```

### Task 12: Record the Markdown baseline and preview evidence boundary

**Files:**
- Create: `evaluation/markdown-baseline/protocol.md`
- Create: `evaluation/markdown-baseline/cases/*.md`
- Create: `evaluation/markdown-baseline/results.schema.json`
- Create: `docs/evaluation/m0-baseline-report.md`
- Create: `README.md`
- Modify: `docs/design/2026-09-04-case-agent-protocol-discovery.md`

**Interfaces:**
- Consumes: frozen four-case baseline and completed conformance output.
- Produces: preregistered comparison procedure, honest report template populated from recorded runs, and preview usage documentation.

- [ ] **Step 1: Freeze the baseline before executing it**

Write four cases: same-version double writer, stale handoff after intervening work, accepted artifact changed, and evidence digest mismatch. For each, record the same starting repository, actor prompts, allowed commands, stop rule, expected failure detection, burden fields, and timeout. `protocol.md` fixes B0 as Markdown plus Git and M0 as protocol plus CLI without a skill.

- [ ] **Step 2: Add the closed result schema**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["arm", "case_id", "detected", "false_success", "user_decisions", "commands", "elapsed_ms", "input_tokens", "output_tokens", "corrections", "outcome"],
  "properties": {
    "arm": { "enum": ["B0", "M0"] },
    "case_id": { "type": "string" },
    "detected": { "type": "boolean" },
    "false_success": { "type": "boolean" },
    "user_decisions": { "type": "integer", "minimum": 0 },
    "commands": { "type": "integer", "minimum": 0 },
    "elapsed_ms": { "type": "integer", "minimum": 0 },
    "input_tokens": { "type": ["integer", "null"], "minimum": 0 },
    "output_tokens": { "type": ["integer", "null"], "minimum": 0 },
    "corrections": { "type": "integer", "minimum": 0 },
    "outcome": { "enum": ["complete", "failed", "timeout", "invalid"] }
  }
}
```

- [ ] **Step 3: Execute and record both arms without excluding failures**

Run every frozen case under B0 and M0 with the same stopping rules. Preserve timeouts, invalid runs, and partial runs. Populate the report only from schema-valid records; identify Node, OS, CLI commit, fixture revision, sample size, and stopping rule.

- [ ] **Step 4: Write the preview README with bounded claims**

Document installation from a local package artifact, the exact M0 commands, offline behavior, data footprint, recovery limitation, recorded-not-authenticated acceptance, lack of audit/sandbox guarantees, and supported profiles proven by the corpus. Do not call the tool reliable, cross-platform, weak-model ready, or enterprise ready unless the recorded report supports that exact claim.

- [ ] **Step 5: Run the final evidence gates**

Run: `npm ci`

Run: `npm run check`

Run: `npm pack --dry-run`

Expected: clean install succeeds, unit/integration/conformance tests pass, the dry-run package contains `dist/src`, schemas, README, and no tests, evaluation artifacts, secrets, or local dossier data.

- [ ] **Step 6: Record the final alignment checkpoint**

Append a dated checkpoint to the living design record containing the tested objective, corpus commit, exact supported profiles, baseline outcome, measured burden, unresolved limitations, and the decision to advance, narrow, or stop. The decision must follow the predeclared gate rather than implementation effort already spent.

- [ ] **Step 7: Commit evaluation and preview documentation**

```text
git add evaluation docs/evaluation/m0-baseline-report.md README.md docs/design/2026-09-04-case-agent-protocol-discovery.md
git commit -m "docs: record the M0 baseline evidence"
```

## Final verification checklist

- [ ] Run `npm ci` from a clean dependency state.
- [ ] Run `npm run typecheck` and record zero errors.
- [ ] Run `npm test` and record the exact pass/fail count.
- [ ] Run `npm run conformance` and record total, passed, failed, and uncovered-rule counts.
- [ ] Run the four B0/M0 comparison cases without dropping timeout or invalid outcomes.
- [ ] Run `npm pack --dry-run` and inspect the complete file list.
- [ ] Run `git diff --check` and confirm no whitespace errors.
- [ ] Run `git status --short` and account for every remaining path.
- [ ] Do not claim completion from a subagent report; independently read the diff and verification output.

## Technology-source notes

- Node.js lists version 24 as LTS and recommends production use of Active or Maintenance LTS releases: <https://nodejs.org/en/about/previous-releases>.
- Ajv release 8.20.0 explicitly adds Node 22/24 support: <https://github.com/ajv-validator/ajv/releases/tag/v8.20.0>.
- TypeScript 7.0.2 and `@types/node` 24.10.0 were pinned from their npm package records on 2026-09-04.
