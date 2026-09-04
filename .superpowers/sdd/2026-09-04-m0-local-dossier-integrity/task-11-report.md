# Task 11 report — frozen M0 conformance corpus

Date: 2026-09-05

Initial Task 11 commit: `9cb67f3777ee82291b21ce73a177845457c41a7a` (`test: add the M0 conformance corpus`).

## Base, isolation, and TDD evidence

- Exact starting commit: `5dca6ce51304a8697df1cd51e3bd5d708984a99c`.
- Worktree: `.worktrees/m0-local-dossier-integrity` only.
- Initial walking-skeleton RED: after adding the closed schemas, ledger, namespace-collision fixture, and first corpus test, the build failed because the compiled conformance runner did not exist. The runner was implemented only after that failure.
- Coverage stayed red during the first implementation until a genuinely executing case covered the remaining direction; no rule label was added solely to clear an uncovered array.
- Review-fix RED: the new independently maintained binding audit initially rejected 16 generic/legacy coverage claims. Those claims were replaced by granular assertions emitted by the runner.
- Review-fix RED: the identical executable-binding-vector audit initially found 25 duplicate clause vectors. The ledger was split into atomic clauses and bindings were narrowed until the duplicate count was zero.
- Review-fix RED: the first complete 125-case mutation run exposed one layering error: the schema rejected an intentionally unstable known-profile array before the stable-order guard ran. The closed enum now admits the three known names while runtime structure still requires exactly one applicable profile; the targeted 5/5 group and the subsequent complete suite passed.

## Exact final inventory

- Normative rules: **239** unique, atomic rules from normative specification sections 6–24.
- Executable rules: **219**.
- External/no-direction rules: **20**.
- Required positive directions: **175**.
- Required negative directions: **174**.
- Direction shape: **130** both directions, **45** positive-only, **44** negative-only.
- Executed cases: **125** total: **41 positive** and **84 negative**.
- Logical case families: **18**.
- Independently maintained bindings: **372** case-direction entries containing **750** granular assertion links.
- Duplicate same-direction case/assertion vectors: **0**.
- Final exact summary: `{"total":125,"passed":125,"failed":0,"uncovered_positive":[],"uncovered_negative":[]}`.

The 20 external/no-direction obligations are:

- Documentation or handoff/check/decision support: `M0-HANDOFF-007`, `M0-CHECK-008`, `M0-CHECK-009`, `M0-DECISION-009`, `M0-OFFLINE-004`, `M0-OFFLINE-006`, `M0-OFFLINE-007`, `M0-OFFLINE-008`, `M0-OFFLINE-010`.
- Public production support declarations: `M0-PLATFORM-001`, `M0-PLATFORM-002`, `M0-PLATFORM-003`.
- Baseline and release gates: `M0-BASELINE-001`, `M0-BASELINE-002`, `M0-BASELINE-003`, `M0-RELEASE-001`, `M0-RELEASE-003`, `M0-RELEASE-007`, `M0-RELEASE-008`.
- A non-executable scalar/documentation obligation: `M0-SCALAR-010`.

They remain present in the ledger rather than being omitted, relabelled executable, or represented as production support. Task 12 documentation/help does not yet exist, so no decorative help scanner is claimed here.

## Coverage-proof design

Folder polarity and fixture rule IDs do not earn coverage. `conformance/bindings.json` is a closed, separately validated case/probe-to-rule manifest. A direction is credited only when:

1. the fixture passes every exact oracle;
2. its declared rule ID and polarity agree with the binding manifest;
3. every bound assertion ID was actually emitted during that execution; and
4. the binding contains material, clause-specific assertions rather than a generic result label.

Assertions identify exact result codes, process exits, JSON pointer values and key sets, tree bytes, Git baseline bytes, storage-event sequence entries, transcript prompts/views/responses/transitions, concurrency outcomes, network observations, or narrowly named protocol predicates. Structural tests reject unknown/unrelated IDs, ordinary-CLI/manifest collusion, probe self-certification, generic or legacy labels, and identical same-direction binding vectors. A separate behavior fingerprint rejects behavior-identical positive/negative fixtures.

The clause audit explicitly separated the reviewer-highlighted pairs and families: JCS positive versus mutation; corpus-red oracle success versus deliberate mismatch; coverage-accounting present versus missing direction; offline policy boundaries versus actual zero-network observation; required-family inventory versus a missing-family mutation; compatible init versus newer-version rejection; and clean/collision/partial namespace behavior. Compound scalar, projection, envelope, state, CLI, handoff, offline, platform, and release statements were split so a narrow assertion cannot claim an unrelated clause.

## Oracle and hardening evidence

- Normal invocations require exact stdout; `stdout_json_file: null` is limited to startup/no-envelope failure. Machine cases use `--json`; human fixtures exercise `renderHuman` and exact stderr prompts.
- Closed interactive-script JSON drives and checks the exact displayed current view and transition, submission review, decision/reviewer/comment/identity limitation, recovery confirmation view, prompt bytes, and exact response phrase. Wrong prompt and wrong phrase mutations turn red.
- Human `dossier show` has real 20-item and 21-item vectors proving required fields, truncation, abbreviated state digest, next action, and warnings.
- Corpus and governed parsers build null-prototype objects with defined own properties, so decoded `__proto__`, `constructor`, and `prototype` spellings survive parsing and are rejected by closed schemas. Exactly 256 nested containers are accepted; 257 are rejected.
- Corpus-relative paths reject traversal, absolute, drive, UNC, backslash, empty, dot, dot-dot, NUL, NTFS ADS, Windows device aliases, and trailing-dot/space aliases. Arrays and rule/profile lists are stably ordered, unique where required, and timestamps are real RFC 3339 UTC instants.
- `actor_label` is constrained and consistency-checked as a non-authoritative trace label.
- Real directory, outside-root, symlink, junction, case-fold alias, adapter ambiguity, and hardlink cases execute the evidence inspection path. The required lstat/realpath/list/open/fstat/read/close and post-open identity sequence is asserted.
- The final oracle compares the exact repository tree plus an immutable harness-owned `.git` baseline. A seeded `.git/config` mutation turns red; corpus before/after hashing includes hidden namespaces relevant to the corpus.
- `after_temp_open` injects immediately after exclusive creation with zero bytes written. Publication, orphan reuse/conflict, recovery-exclusivity races, orphan decision re-confirmation, locale/wall-clock independence, and the required initialization classifications are executed.
- The Windows production-profile fixture launches the frozen public CLI and asserts exit class 10, one exact JSON line containing `CASE_E_UNSUPPORTED_PROFILE`, and exact stderr. Controlled-test is not used for that result.

## Mutation/red capability

The focused suite proves each of the following turns the oracle red: a state-critical dossier corruption even after refreshing the fixture byte digest; expected stdout, final tree, or derived view changes; a Git config byte change; a network attempt during derived-view generation; a delayed network attempt during final hooks; an unrelated known rule ID on a probe or ordinary CLI case; an identical cross-polarity behavior vector; an identical rule binding vector; decoded prototype keys; unsafe path aliases; invalid timestamps or ordering; and wrong interactive prompt/response bytes.

The corpus also executes every named fault point, exactly-one-writer races, guard recovery races, immutable-envelope corruption/cross-file mismatch, and post-replace validation. Expected files and fixture-declared labels are never trusted as pass signals.

## Verification

- Focused command: `node --test dist/tests/conformance/corpus.test.js`.
- Focused result: **41 passed**, 0 failed, 0 cancelled, 0 skipped, 0 todo; duration **183794.5713 ms**.
- Required full command: `& 'C:\Program Files\nodejs\npm.cmd' --cache .npm-cache run check`.
- Typecheck: zero errors.
- Final staged-state full test result: **251 passed**, 0 failed, 0 cancelled, 0 skipped, 0 todo; duration **201781.9576 ms**.
- Standalone corpus phase in the full check: `{"total":125,"passed":125,"failed":0,"uncovered_positive":[],"uncovered_negative":[]}`.
- Final standalone corpus rerun: the same exact summary.
- Final static gates: zero duplicate binding vectors; the executed focused and full suites reported zero skipped/todo tests; `git diff --check` clean.

## Boundaries and remaining limitations

- Corpus workflow execution uses the explicitly test-only `controlled-test` capability. It exercises the real CLI dispatcher and workflows in process; it is not a production Windows or POSIX adapter.
- Production Windows remains deliberately unsupported and returns `CASE_E_UNSUPPORTED_PROFILE`. Production POSIX remains unclaimed. Passing the controlled corpus does not satisfy the real-platform release gate.
- The network audit begins before schema/dependency setup, remains active through derived-view and final hooks, observes DNS/TCP/TLS/UDP async resources, and performs a bounded deterministic drain. It proves zero in-process network initialization for the walking skeleton and other controlled cases. It cannot observe traffic created by an arbitrary child process; the separate public-CLI subprocess vector proves its exact unsupported result, not a child-process network sandbox.
- Corpus metadata uses an independent strict bootstrap parser because fixture metadata necessarily contains numeric process exits while governed protocol JSON forbids every number. Sharing the production governed parser would let the subject under test certify its own malformed-JSON fixtures. The bootstrap parser independently enforces strict UTF-8, BOM, duplicate decoded keys, Unicode validity, safe integers, exact 256-depth handling, and trailing-data rejection.
- File identity and TOCTOU checks are bounded to the specified adapter observations and open handle. The corpus does not claim an operating-system-wide adversary-proof sandbox.
- Markdown baselines, public support-matrix documentation, Task 12 help, release packaging, and independent release review remain external gates and are not claimed by this corpus.
