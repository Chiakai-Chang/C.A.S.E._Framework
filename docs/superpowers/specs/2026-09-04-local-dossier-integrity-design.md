---
title: M0 Local Dossier Integrity
status: accepted-design
last_updated: 2026-09-04
authority: design-specification
target_release: 0.1.0-preview
---

# M0 Local Dossier Integrity Design

## 1. Goal

M0 proves that a small, local, file-native protocol can detect stale handoffs, stale human acceptance, conflicting writers, and changed evidence more reliably than an ordinary Markdown handoff, without requiring a multi-agent runtime or a large always-on prompt.

The user-visible promise is deliberately narrow:

> A person can create one work dossier, let one agent hand it to another, submit an exact result for review, record a human decision, and later detect when the accepted result is no longer current.

M0 is a protocol and deterministic-tool milestone. It is not yet a claim that C.A.S.E. improves general agent quality.

## 2. Alignment with the project objective

The project objective is to let human-directed coding agents preserve, validate, and hand off work across limited contexts and different hosts while minimizing unnecessary cognitive and decision burden.

M0 advances that objective by proving four properties that plain chat and informal Markdown do not reliably provide:

1. stale handoff detection;
2. stale acceptance detection;
3. exactly one successful governed mutation when two conforming writers compete;
4. recomputable linkage between acceptance criteria, evidence, and exact artifact content.

The smallest alternative is a Markdown template plus Git. That alternative remains the baseline. If M0 cannot measurably reduce the four target failure modes, C.A.S.E. stops expanding and is reduced to the smallest validator that provides demonstrable value.

## 3. Scope

### 3.1 Included

- one repository-local `.case-agent/` namespace;
- one or more independent dossiers, each with at most one active writer;
- deterministic initialization, creation, inspection, validation, evidence registration, submission, recorded human acceptance or rejection, and handoff;
- a canonical JSON snapshot for current state;
- immutable handoff, submission, and decision envelopes;
- canonical semantic digests;
- a writer guard plus revision and digest preconditions;
- machine-readable errors with one safe remediation hint;
- a bounded human-readable current view generated from canonical state;
- positive and negative conformance fixtures;
- a plain-Markdown baseline comparison for the four target failure modes.

### 3.2 Explicitly excluded

- portable skills and host connection helpers;
- Codex, Claude Code, or Pi plugins and packages;
- automatic agent selection, launch, scheduling, ranking, voting, or consensus;
- MECE role simulation or `decision-challenge`;
- operation receipts;
- hooks, MCP, telemetry, notifications, or automatic context compaction;
- automatic repair of Pi or another host;
- multi-machine coordination, separate-clone synchronization, semantic merge, or network-filesystem locking;
- authenticated identity, signatures, tamper-proof history, or complete audit trails;
- durable multi-file transactions or guarantees across physical power loss;
- claims of enterprise readiness, weak-model support, or general reliability improvement.

## 4. Operating boundary

M0 guarantees mutation serialization only when all of the following are true:

- all governed mutations use a conforming CLI or implementation;
- competing processes run on one machine;
- `.case-agent/` is on one supported local filesystem;
- the namespace and governed files are not symlinks, junctions, reparse-point escapes, or network shares;
- no external program edits governed files during a mutation.

Separate clones, cloud-sync folders, network shares, non-cooperating writers, memory-mapped readers, and physical power loss are outside the guarantee. A conforming implementation detects unsupported conditions when practical and otherwise states the residual risk without silently widening its claim.

## 5. User journey

The walking skeleton is:

```text
init repository
  -> create dossier with objective, scope, and acceptance criteria
  -> assign run A as active writer
  -> register criterion-linked evidence
  -> run current checks
  -> offer handoff to actor B at revision N
  -> B accepts the still-current offer and becomes active writer
  -> B reruns checks and submits exact content plus evidence
  -> a human records acceptance of that submission
  -> a covered artifact changes
  -> show/check reports the acceptance as stale
```

The CLI may combine low-risk setup steps for usability, but the protocol observations and failure semantics remain distinguishable.

## 6. Source of truth and file topology

```text
.case-agent/
  manifest.json
  dossiers/
    <dossier-id>/
      dossier.json
      handoffs/
        <handoff-id>.json
      submissions/
        <submission-id>.json
      decisions/
        <decision-id>.json
  locks/
    <dossier-id>.lock
```

Rules:

- `manifest.json` identifies ownership, protocol version, repository identity, and supported schema dialect.
- `dossier.json` is the sole canonical truth for current governed state.
- handoff, submission, and decision envelopes are immutable create-once records.
- only records referenced by the current snapshot affect current state.
- an unreferenced immutable record is an orphan, not current truth. Validation reports it but does not apply it.
- `locks/` is transient coordination state, not dossier truth or history.
- M0 has no authoritative `brief.md`. Human-readable views are generated from canonical data so that Markdown cannot become a second editable truth.

## 7. Identifiers and scalar conventions

- Repository, dossier, run, handoff, submission, decision, criterion, evidence, operation, and actor identifiers are opaque strings generated or validated by the reference CLI.
- Repository, dossier, run, handoff, submission, decision, criterion, and evidence IDs are never reused within their scope. Operation IDs are unique only within one dossier and basis revision; reuse at a later basis revision is outside M0's global-deduplication guarantee.
- Human-readable titles are display metadata and never identity.
- Revisions are non-negative decimal strings without leading zeroes except `"0"`. Strings avoid cross-runtime integer loss.
- Digests use `sha256:<lowercase-hex>`.
- Timestamps use UTC RFC 3339 strings with `Z`; ordering and concurrency never depend on wall-clock time.
- Machine fields and error codes are English ASCII and locale-invariant. Human explanatory text may be localized later.

## 8. Canonical JSON and digest contract

### 8.1 Parsing gate

Before schema validation, a conforming implementation rejects:

- bytes that are not valid UTF-8;
- duplicate object member names after JSON escape decoding;
- isolated Unicode surrogates or noncharacters;
- numbers that cannot be represented safely under the protocol's restricted numeric model;
- byte-order marks where a governed JSON artifact does not explicitly permit them.

All protocol counters and revisions use restricted decimal strings. Protocol JSON does not use floating-point values.

### 8.2 Schema gate

- Schemas use JSON Schema Draft 2020-12.
- Every root schema declares the dialect explicitly and has a stable `$id`.
- Protocol version and schema dialect are separate fields.
- Runtime validation is offline; schemas and references are bundled and pinned.
- Security- and state-critical objects are closed. Unknown critical fields and unknown major versions fail closed.
- JSON Schema `format`, `default`, and `examples` are not relied on as the sole validity or authorization mechanism.

### 8.3 Canonicalization

Canonical bytes are UTF-8 bytes produced by RFC 8785 JSON Canonicalization Scheme over an explicitly defined digest projection.

```text
digest(value) = "sha256:" + lowercase_hex(SHA-256(UTF-8(JCS(projection(value)))))
```

JCS does not normalize Unicode. NFC and NFD text therefore remain distinct values. Array order remains significant.

### 8.4 Digest projections

The protocol defines four separate concepts:

- `state_revision`: compare-and-swap precondition for any governed mutation;
- `state_digest`: digest of the named `dossier_state_projection`, containing every canonical field stored in `dossier.json` except `state_digest` itself;
- `content_digest`: a pure function of governed data stored in `dossier.json`: objective, scope, constraints, acceptance criteria, and registered evidence records including their declared artifact digests;
- `submission_digest`: submission envelope projection containing dossier ID, content digest, observed evidence digest, checks digest, submitting run, and creation operation ID.

The `dossier_state_projection` contains exactly: dossier ID, title, objective, scope, constraints, acceptance criteria, state revision, last-operation record, lifecycle, active run, evidence records, and the three current envelope IDs. It excludes only the stored `state_digest`. Implementations may not invent additional exclusions.

Assignment, lock metadata, display timestamps, and orphan records do not alter `content_digest`. Filesystem observations never silently alter it either. A governed change to objective, scope, constraints, criteria, or a registered evidence record does alter it.

`check` separately computes an `observed_evidence_digest` from the ordered evidence records, their current mechanically observed status, and current bytes where applicable. An external artifact change therefore makes an existing submission and decision stale without silently changing `state_revision` or the stored `content_digest`.

## 9. Minimal canonical state

The schema files created during implementation will encode the following logical fields.

### 9.1 Manifest

```text
protocol: "case-agent"
protocol_version: "0.1.0-preview"
schema_dialect: "https://json-schema.org/draft/2020-12/schema"
repository_id: opaque ID
created_at: timestamp
```

### 9.2 Dossier snapshot

```text
dossier_id
title
objective
scope.in[]
scope.out[]
constraints[]
acceptance_criteria[]: { criterion_id, statement }
state_revision
state_digest
last_operation: null | {
  operation_id,
  input_digest,
  basis_revision,
  resulting_revision
}
lifecycle: open | abandoned | archived
active_run: null | { run_id, actor_id }
evidence[]: evidence record
current_handoff_id: null | handoff ID
current_submission_id: null | submission ID
current_decision_id: null | decision ID
```

An evidence record contains:

```text
evidence_id
criterion_ids[]
kind: file | command_result | external_reference | human_observation
locator
captured_at
artifact_digest: required for file and captured command-result artifacts
artifact_size: required when artifact_digest is present
freshness: immutable | recompute_on_check | human_review
limitations[]
```

M0 mechanically validates local file evidence. External references and human observations can be recorded but remain `human_review` and cannot alone satisfy a mechanically verifiable criterion.

## 10. Derived status, not duplicated truth

The CLI derives these views instead of storing a free-standing `DONE` field or mutable checks cache:

```text
current_checks: passed | failed
review: working | ready_for_review | changes_requested
acceptance: pending | accepted | rejected | stale
handoff: none | offered | accepted | stale
```

Invalid combinations are avoided by derivation:

- `current_checks` is recomputed from canonical state and present evidence observations whenever `check`, `show`, or `submission create` needs it.
- `ready_for_review` requires a current submission whose embedded checks, observed evidence, and covered content still match.
- `accepted` requires a referenced acceptance decision whose submission digest is still current.
- any covered-content change makes a referenced submission's embedded checks, an unaccepted handoff offer, and dependent decisions stale where their projections no longer match.
- rejection returns the review view to `changes_requested`; a later submission is a new immutable envelope.
- abandoning or archiving a dossier removes the active writer and prohibits ordinary work mutations.
- reopening is not part of M0. A new dossier is created instead.
- deletion and purge are not part of M0.

## 11. Writer guard and governed mutation

Atomic replacement plus a revision check is not compare-and-swap. Every governed mutation follows this order:

1. create the dossier lock file using an exclusive create primitive;
2. after acquiring the guard, read and validate the current snapshot;
3. compare expected revision, expected state digest, and operation ID;
4. construct and validate the new complete snapshot;
5. write a temporary file in the target directory;
6. flush and close it according to the supported platform profile;
7. publish it with one platform replace primitive;
8. reopen and validate the published snapshot;
9. release the writer guard.

Idempotency is scoped to `(dossier_id, basis_revision, operation_id)`. Before normal precondition handling, the implementation compares the request input digest with the snapshot's `last_operation`. An identical immediate retry returns the prior success without another transition. Once a later operation advances the snapshot, replaying an older operation returns a conflict because M0 retains no unbounded operation history. Reusing the current operation ID with different input is an error.

A dossier lock records a random guard ID, the basis revision and digest, creation time, and the process-identity evidence defined by its declared platform profile. A lock older than a threshold is only `possibly_stale`; it is never automatically taken over.

`guard recover` first obtains a separate create-exclusive recovery guard. While it exists, ordinary writer acquisition and any second recovery attempt fail visibly. The command then requires an interactive human to confirm recovery and uses the platform profile's declared process mechanism to establish that the recorded owner has terminated. If that mechanism is unavailable or inconclusive, recovery stops. Otherwise it quarantines the old lock, revalidates the snapshot, advances the snapshot revision through a guarded no-op mutation, and releases the recovery guard only after verification.

M0 does not claim safe recovery while the old writer may still be live: deleting or renaming a lock pathname cannot revoke a process that still holds an earlier handle. If termination cannot be established operationally, recovery stops with `CASE_E_RECOVERY_REQUIRED`. The exactly-one-writer guarantee resumes only after the old process is terminated and recovery completes.

POSIX and Windows may use different locking and replace implementations. The shared protocol promises only the behavior proven by each declared platform profile.

## 12. Immutable-envelope publication

Submission, decision, and handoff operations can touch both a create-once envelope and the snapshot pointer. M0 uses a recoverable two-step pattern rather than claiming an atomic multi-file transaction:

1. acquire the writer guard and validate preconditions;
2. create the immutable envelope with an operation-derived ID;
3. validate the envelope and its digest;
4. atomically replace the snapshot so it references the envelope;
5. verify the referenced state;
6. release the guard.

A crash before step 4 may leave an orphan envelope. It has no authority. Envelope IDs are derived from the operation ID, and the first create attempt fixes all persisted IDs and timestamps. Retrying the same operation recovers those values from the existing envelope, verifies its input projection and bytes, and completes the pointer update without regenerating volatile fields. A conflicting envelope with the same ID fails closed.

## 13. Handoff semantics

A handoff offer records:

```text
handoff_id
dossier_id
from_run_id
to_actor_id
basis_revision
basis_state_digest
published_revision
offered_content_digest
created_operation_id
status_basis: immutable offer data
```

- only the active run can create an offer;
- creating an offer does not transfer responsibility;
- `basis_revision` and `basis_state_digest` identify the validated pre-offer snapshot;
- `published_revision` is the deterministic next revision of the post-offer snapshot; the envelope never embeds a digest of a snapshot that references the same envelope;
- creating the offer is the transition from the basis revision to the published revision and does not make the offer stale;
- acceptance must name the intended actor, find the exact `published_revision`, match the offered content digest, active run, and `current_handoff_id`, and independently validate the current stored `state_digest` supplied as the command precondition;
- successful acceptance creates a new run for the recipient and atomically changes `active_run` under the writer guard;
- the previous run loses write authority immediately after the snapshot update;
- any governed mutation that invalidates the offer's state projection makes it stale;
- actor labels are recorded claims, not authenticated identities;
- offer cancellation is permitted only by the active writer before acceptance; it clears `current_handoff_id`, after which the current handoff view is `none`. M0 preserves no canonical cancelled-handoff history.
- after acceptance, the current handoff view remains `accepted` while the snapshot references that handoff and its resulting active run. Later ordinary work mutations do not retroactively make an accepted handoff stale; a later handoff replaces the current reference.

## 14. Checks and evidence semantics

`check` is read-only, never advances `state_revision`, and performs distinct stages that it reports separately:

1. byte and JSON parsing validity;
2. schema and protocol-version validity;
3. cross-file and transition validity;
4. root containment and file-type safety;
5. evidence existence, size, digest, criterion linkage, and freshness;
6. referenced immutable-envelope integrity;
7. deterministic `checks_digest`, `observed_evidence_digest`, and derived current status.

`submission create` reruns these checks after acquiring the writer guard and embeds their digests in the immutable submission envelope. The snapshot stores no mutable checks result. A later `show` or `check` compares fresh observations with the referenced submission to derive whether it remains current.

A validator exception is an internal error and can never produce a valid result.

Passing checks means only that declared, machine-checkable invariants hold. It does not establish usefulness, factual correctness, code quality, or human acceptance.

Local artifact validation uses an open-read-validate-close flow and rejects evidence outside the repository root, symlinks, junctions, unsupported reparse points, directories, empty files where emptiness was not explicitly allowed, and files whose bytes no longer match. TOCTOU risk outside the validated handle and non-cooperating filesystem changes remains a documented limitation.

## 15. Recorded human decision

An acceptance or rejection decision is bound to one exact submission digest and records:

```text
decision_id
dossier_id
submission_id
submission_digest
decision: accepted | rejected
reviewer_id
criteria_reviewed[]
comment
decided_at
created_operation_id
identity_assurance: "recorded-interactive-claim"
```

The reference CLI requires an interactive terminal, displays the exact submission digest and criteria, and asks for an explicit confirmation phrase. M0 provides no `--yes` or non-interactive acceptance path. Every decision invocation requires this flow, including recovery of an orphan decision envelope after interruption. In that case the CLI displays the recovered envelope and exact submission digest before it may update the snapshot pointer; the orphan's existence is never sufficient authorization.

This is friction against accidental or casual agent self-approval, not strong authentication. A program controlling the terminal can still impersonate a reviewer. Output and documentation must consistently say **Recorded Human Acceptance**, never authenticated approval, attestation, or non-repudiation.

## 16. Reference CLI interface

The initial command surface is:

```text
case-agent init
case-agent dossier create
case-agent dossier show
case-agent dossier check
case-agent dossier abandon
case-agent dossier archive
case-agent evidence add
case-agent submission create
case-agent decision accept
case-agent decision reject
case-agent handoff offer
case-agent handoff accept
case-agent handoff cancel
case-agent guard recover
```

`dossier create` creates the initial active run for the recorded actor supplied by the human. `dossier abandon` is allowed only while open and clears the active run and current handoff. `dossier archive` is allowed only after a current acceptance or abandonment and makes the dossier read-only. M0 has no reopen transition.

All mutating commands require an operation ID. All mutations to an existing dossier require expected revision and expected state digest. Human mode may obtain these from a just-displayed current view, but machine mode must provide them explicitly.

Human mode is the default. `--json` selects machine mode. With `--json`, every failure after process startup and argument decoding, including `CASE_E_INTERNAL`, writes exactly one valid result envelope to stdout. Human output is a rendering of the same structured result.

```text
ok: boolean
command: stable command identifier
code: stable success or error code
message: concise human explanation
data: command-specific object or null
remediation: one safe next action or null
```

Stdout contains the requested human or JSON result. In JSON mode, stderr contains no machine-required information. It may contain diagnostics only when the executable cannot start or cannot enter JSON mode at all; those failures are outside normal conformance invocation. Warnings are represented in the result and do not silently change validity. Machine consumers branch only on `code` and process exit code, never on localized `message`. Locale never changes machine fields.

## 17. Stable error families

M0 defines stable symbolic codes. Process exit codes group them by class; callers that need exact handling inspect the symbolic code in the JSON result.

```text
CASE_E_USAGE                 malformed invocation
CASE_E_NOT_INITIALIZED       namespace absent
CASE_E_NAMESPACE_COLLISION   incompatible or unsafe namespace
CASE_E_UNSUPPORTED_VERSION   unsupported protocol/schema version
CASE_E_PARSE                 invalid governed JSON bytes or syntax
CASE_E_SCHEMA                schema invalid
CASE_E_INVARIANT             cross-file or state invariant invalid
CASE_E_CONFLICT              expected revision/digest is stale
CASE_E_BUSY                  writer guard currently held
CASE_E_RECOVERY_REQUIRED     possibly stale guard or interrupted mutation
CASE_E_EVIDENCE              evidence missing, unsafe, changed, or stale
CASE_E_TRANSITION            requested lifecycle transition is illegal
CASE_E_ACTOR                 recorded actor does not match required actor label
CASE_E_HUMAN_CONFIRMATION    interactive recorded-human flow unavailable
CASE_E_INTERNAL              unexpected implementation failure
```

```text
0   success
2   invocation or usage error
10  initialization, namespace, environment, or version error
20  parse, schema, invariant, or evidence error
30  conflict, busy, or recovery-required error
40  transition, actor-label, or human-confirmation error
70  internal implementation error
```

No error may recommend destructive deletion as its default remediation.

## 18. Current view

`dossier show` presents only what is needed for the next correct action:

- dossier title and objective;
- scope and constraints only when requested or currently violated;
- active writer and run;
- current revision and abbreviated digest;
- acceptance-criterion status and evidence gaps;
- checks, review, acceptance, and handoff status;
- exactly one recommended next valid action;
- unresolved warning when identity, freshness, or environment cannot be mechanically proven.

`--json` exposes the complete structured view. Human output has a bounded default size and points to deeper data rather than embedding large evidence.

## 19. Initialization and repository trust

- Repository root discovery starts from the current directory and resolves to the owning version-control work tree when available.
- The resolved root is displayed before mutation.
- `init` creates only `.case-agent/` and changes no byte outside it.
- Existing incompatible, partial, symlinked, junctioned, or unknown `.case-agent/` content causes a fail-closed collision result before writes.
- Re-running the same initialization is idempotent.
- An unsupported newer major version is read-only inspectable but never modified.
- M0 does not modify `.gitignore`, host instructions, hooks, PATH, or user-global configuration.

Nested repositories, submodules, linked worktrees, case-insensitive aliases, UNC paths, cloud-sync paths, and clone-with-active-writer fixtures must be explicitly classified by the implementation before their support can be claimed.

## 20. Offline and data policy

- Core commands perform no network access.
- Schemas, conformance data required at runtime, and human help are bundled.
- Update checks are absent in M0.
- Telemetry is absent in M0.
- Dossier content may contain sensitive repository information. The tool does not claim to detect or protect all secrets.
- Evidence stores references and digests by default; it does not copy artifact bytes unless a later explicit feature defines that behavior.
- Uninstalling a CLI never removes `.case-agent/` data.
- Purge and retention automation are outside M0.

Offline operation does not imply supply-chain verification, sandboxing, privacy certification, or protection from other local processes.

## 21. Platform profiles

The protocol is host-neutral, but filesystem publication behavior is platform-profiled.

### POSIX local profile

- temporary file is created in the target directory;
- create-once files use exclusive creation;
- current snapshot publication uses the declared local-filesystem rename primitive;
- readers open, fully read, validate, and close each snapshot;
- the implementation declares how it verifies the recorded process identity for recovery; if the platform cannot establish termination, automated recovery is unsupported;
- process-crash tests distinguish process safety from physical-power-loss durability.

### Windows local profile

- temporary file is created in the target directory and volume;
- create-once files use `CREATE_NEW`-equivalent behavior;
- current snapshot publication uses a single supported replacement primitive;
- readers permit required delete sharing, then open, fully read, validate, and close;
- recovery verifies the recorded process identity using the declared Windows process mechanism before quarantining a lock;
- sharing violations are visible and retry-bounded;
- replace failure is followed by target-state verification and may return recovery-required rather than assuming the old file remains present.

The public support matrix lists only profiles that pass the frozen corpus.

## 22. Conformance strategy

Every normative MUST in the future L0 specification receives at least one positive and one negative vector. M0 includes journey tests as well as isolated schema tests.

Blocking families are:

1. initialization confinement and namespace collision;
2. I-JSON parsing, Draft 2020-12 schema, JCS vectors, and digest projections;
3. concurrent writers with exactly one success among conforming competitors;
4. idempotent retries and conflicting operation-ID reuse;
5. interruption at every immutable-envelope and snapshot publication boundary;
6. stale and live writer guards, recovery after confirmed process termination, and refusal when termination is uncertain;
7. missing, empty, changed, external, symlinked, junctioned, or aliased evidence;
8. stale handoff, wrong recipient, double accept, cancellation, and old-writer mutation;
9. submission without current checks and evidence;
10. interactive decision requirement and stale acceptance after artifact mutation;
11. unsupported versions, unknown states, unknown critical fields, and validator exceptions;
12. bounded file-only rehydration through `dossier show`;
13. Windows/POSIX line ending, key ordering, BOM, Unicode, case, and separator cases;
14. offline execution with zero network calls.

Mutation testing or an explicit equivalent fault-injection method must show that state-critical validators are capable of turning red.

## 23. Baseline evaluation

Before adding a skill or second-host adapter, freeze a compact comparison covering:

- two writers start from the same version;
- a handoff is accepted after intervening work;
- an accepted artifact changes;
- recorded evidence no longer matches the artifact.

Compare:

- B0: ordinary Markdown handoff plus Git;
- M0: L0 protocol plus reference CLI, without a skill.

Primary metric is correct detection of the four failure modes without false success. Secondary metrics are user decisions, commands, elapsed time, context consumed, recovery steps, and false blocks.

M0 advances only if it detects all four target failures and its additional burden is documented and acceptable. The result does not justify broader reliability claims.

## 24. Release gates

M0 remains **not releasable** until all of these are true:

- the normative L0 specification and schema projections are complete;
- every MUST has positive and negative fixtures;
- the full frozen corpus passes on every claimed platform profile;
- race tests produce exactly one successful conforming mutation;
- no direct-edit, stale-evidence, stale-handoff, or stale-acceptance fixture can become green;
- validator exceptions fail closed;
- the complete walking skeleton succeeds without network access;
- a context-loss run resumes from the bounded current view;
- the Markdown baseline comparison is recorded;
- documentation uses no unsupported identity, audit, sandbox, enterprise, weak-model, or general-reliability claim;
- an independent review finds no contradiction between spec, schemas, CLI behavior, and fixtures.

The first preview may claim only file-native state, machine-checkable invariants, revision-protected human-directed handoff, and the exact platform-profile results demonstrated by the corpus.

## 25. Module seams for implementation planning

The reference implementation should expose one deep protocol module whose interface covers:

```text
load and validate repository state
compute canonical projections and digests
derive current dossier view
evaluate a proposed transition
apply one guarded mutation
```

CLI commands are thin adapters at that seam. Filesystem publication, clock/ID generation, and terminal confirmation are internal seams with production and test adapters. Schema rules, digest rules, and transition rules must not be duplicated across commands.

No host adapter seam is created in M0 because there is not yet a second host implementation. L1 and L3 consume L0 later; they are not required dependencies of the reference CLI.

## 26. References

- [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)
- [RFC 7493: The I-JSON Message Format](https://www.rfc-editor.org/rfc/rfc7493.html)
- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- [POSIX `rename()`](https://pubs.opengroup.org/onlinepubs/9699919799/functions/rename.html)
- [POSIX `open()` and `O_EXCL`](https://pubs.opengroup.org/onlinepubs/9699919799/functions/open.html)
- [Microsoft `ReplaceFile`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilea)
- [Microsoft `CreateFile`](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilea)
