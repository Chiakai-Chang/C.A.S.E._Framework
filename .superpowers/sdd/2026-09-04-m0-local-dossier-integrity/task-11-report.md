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

## Round 1 inventory (superseded by the fix-round-2 inventory below)

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

Assertions identify exact result codes, process exits, JSON pointer values and key sets, tree bytes, Git baseline bytes, storage-event sequence entries, transcript prompts/views/responses/transitions, concurrency outcomes, network observations, or narrowly named protocol predicates. Structural tests reject unknown/unrelated IDs, ordinary-CLI/manifest collusion, probe self-certification, generic or legacy labels, and identical same-direction binding vectors. A content-normalized behavior fingerprint rejects behavior-identical positive/negative fixtures even when their reference filenames differ.

The clause audit explicitly separated the reviewer-highlighted pairs and families: JCS positive versus mutation; corpus-red oracle success versus deliberate mismatch; coverage-accounting present versus missing direction; offline policy boundaries versus actual zero-network observation; required-family inventory versus a missing-family mutation; compatible init versus newer-version rejection; and clean/collision/partial namespace behavior. Compound scalar, projection, envelope, state, CLI, handoff, offline, platform, and release statements were split so a narrow assertion cannot claim an unrelated clause.

## Oracle and hardening evidence

- Normal invocations require exact stdout; `stdout_json_file: null` is limited to startup/no-envelope failure. Machine cases use `--json`; human fixtures exercise `renderHuman` and exact stderr prompts.
- Closed interactive-script JSON drives and checks the exact displayed current view and transition, submission review, decision/reviewer/comment/identity limitation, recovery confirmation view, prompt bytes, and exact response phrase. Wrong prompt and wrong phrase mutations turn red.
- Human `dossier show` has real 20-item and 21-item vectors proving required fields, truncation, abbreviated state digest, next action, and warnings.
- Corpus and governed parsers build null-prototype objects with defined own properties, so decoded `__proto__`, `constructor`, and `prototype` spellings survive parsing and are rejected by closed schemas. Exactly 256 nested containers are accepted; 257 are rejected.
- Corpus-relative paths reject traversal, absolute, drive, UNC, backslash, empty, dot, dot-dot, NUL, NTFS ADS, Windows device aliases, and trailing-dot/space aliases. Arrays and rule/profile lists are stably ordered, unique where required, and timestamps are real RFC 3339 UTC instants.
- `actor_label` is only a closed, non-authoritative trace label. It is neither compared with nor treated as workflow/process identity.
- Real directory, outside-root, symlink, junction, case-fold alias, adapter ambiguity, and hardlink cases execute the evidence inspection path. The required lstat/realpath/list/open/fstat/read/close and post-open identity sequence is asserted.
- The final oracle compares the exact repository tree plus an immutable harness-owned `.git` baseline. A seeded `.git/config` mutation turns red; corpus before/after hashing includes hidden namespaces relevant to the corpus.
- `after_temp_open` injects immediately after exclusive creation with zero bytes written. Publication, orphan reuse/conflict, recovery-exclusivity races, orphan decision re-confirmation, locale/wall-clock independence, and the required initialization classifications are executed.
- The Windows production-profile fixture launches the frozen public CLI and asserts exit class 10, one exact JSON line containing `CASE_E_UNSUPPORTED_PROFILE`, and exact stderr. Controlled-test is not used for that result.

## Mutation/red capability

The focused suite proves each of the following turns the oracle red: a state-critical dossier corruption even after refreshing the fixture byte digest; expected stdout, final tree, or derived view changes; a Git config byte change; a network attempt during derived-view generation; a delayed network attempt during final hooks; an unrelated known rule ID on a probe or ordinary CLI case; an identical cross-polarity behavior vector; an identical rule binding vector; decoded prototype keys; unsafe path aliases; invalid timestamps or ordering; and wrong interactive prompt/response bytes.

The corpus also executes every named fault point, exactly-one-writer races, guard recovery races, immutable-envelope corruption/cross-file mismatch, and post-replace validation. Expected files and fixture-declared labels are never trusted as pass signals.

## Round 1 verification (superseded below)

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
- The network audit begins before schema/dependency setup, remains active through derived-view and final hooks, observes DNS/TCP/TLS/UDP async resources, and requires case-created timers/immediates to be quiescent at completion. It proves zero in-process network initialization for the walking skeleton and other controlled cases. It cannot observe traffic created by an arbitrary child process; the separate public-CLI subprocess vector proves its exact unsupported result, not a child-process network sandbox.
- Corpus metadata uses an independent strict bootstrap parser because fixture metadata necessarily contains numeric process exits while governed protocol JSON forbids every number. Sharing the production governed parser would let the subject under test certify its own malformed-JSON fixtures. The bootstrap parser independently enforces strict UTF-8, BOM, duplicate decoded keys, Unicode validity, safe integers, exact 256-depth handling, and trailing-data rejection.
- File identity and TOCTOU checks are bounded to the specified adapter observations and open handle. The corpus does not claim an operating-system-wide adversary-proof sandbox.
- Markdown baselines, public support-matrix documentation, Task 12 help, release packaging, and independent release review remain external gates and are not claimed by this corpus.

## Fix round 2 — final inventory and evidence

Fix round 2 started from `1907e2ce8ea5aa9458f6be06bb5d99f0dbc67f5f` and addressed every actionable independent-review finding without adding a second assertion-to-rule allowlist. Per the controller ruling, the honest trust boundary remains the closed independent binding manifest, actually emitted execution facts, polarity and content-normalized duplicate guards, mutation tests, and an independent release review. Coordinated tampering of all repository-owned conformance artifacts is not claimed to be solved internally.

Final inventory:

- Normative rules: **243** total; **223 executable** and **20 external/no-direction**.
- Required directions: **178 positive** and **176 negative**; **131 both**, **47 positive-only**, and **45 negative-only**.
- Executed cases: **129** total across **18** logical families: **42 positive** and **87 negative**.
- Independent bindings: **379** case-direction entries, exactly matching **379** fixture case-rule links, containing **782** clause-specific emitted-assertion links.
- Binding manifest entries cover all **243** rules, including empty entries for the 20 honestly external obligations.
- Final exact corpus summary: `{"total":129,"passed":129,"failed":0,"uncovered_positive":[],"uncovered_negative":[]}`.

Round-2 RED evidence included: missing Windows reserved-name aliases; unbounded large human strings; an unreadable handoff directory hiding later scans; byte-identical behavior hidden behind alternate reference filenames; the old byte-identical per-case environment restriction; delayed DNS attempts surviving the arbitrary drain; and the initial focused audit finding an identical `M0-OFFLINE-002`/`M0-CORPUS-003` binding vector. The latter was corrected by binding the offline bundle rule to both the governed-schema-registry fact and the full runtime-reference fact, while `M0-CORPUS-003` remains bound specifically to the runner's complete all-runtime-reference assertion. The first full run also exposed an over-broad linked-artifact test double; it was narrowed to the target artifact path, preserving the assertion that the linked artifact is never opened, and the final full run passed.

The frozen fixture contract and closed schema now agree on `stderr: empty | exact | startup_failure_only`, mandatory `stderr_file`, their three exact relations, and corpus-local prompt references. Normal machine fixtures render through `--json`; the human fixtures use the human renderer and exact transcript/prompt bytes.

Human show coverage now has exact 20-item, 21-item, and huge-Unicode vectors. Every bounded collection states total/shown/omitted, abbreviation always gives `rerun with --json`, each field is capped at 256 UTF-8 bytes, total output is capped at 16,384 UTF-8 bytes, and required dossier/run coordinates, revision, abbreviated state digest, and next action remain present. `M0-SHOW-002` is honestly positive-only; `M0-SHOW-004` and `M0-SHOW-005` carry the exact clause-specific count/route and byte-bound assertions.

The network audit now uses an async scope established before repository setup, schema loading, and dependency construction. It stays active through invocation, derived-view, final-tree, Git-baseline, and final assertion hooks; any DNS/TCP/TLS/UDP initialization turns the case red, as does any case-created pending timer or immediate. Derived-view and final-hook mutations schedule DNS after more than 100 ms and turn red immediately without sleeping. Child-process traffic remains outside this in-process observation boundary.

Orphan scanning now fails closed per directory, continues scanning every remaining handoff/submission/decision directory after a local failure, and returns `CASE_E_INVARIANT` when history cannot be trusted. Recoverable orphans are restricted to valid stored publication facts targeting the current state; valid records targeting noncurrent state are superseded immutable history. Real handoff, submission, and decision cases cover recoverable listing/reconfirmation, failed earlier directory scans, and stale history. Orphan warnings are added only after the canonical checks projection; a direct digest test proves they cannot contaminate `checks_digest`.

Corpus and evidence paths additionally reject `CLOCK$`, `CONIN$`, `CONOUT$`, and the Windows `COM`/`LPT` superscript-1/2/3 forms, case-insensitively and with extensions. Invocation-specific clocks, ID seeds, process IDs, start times, and process status now feed each invocation's dependencies while repository and atomic state remain shared; sequential reversed clocks and concurrent distinct identities are executed deterministically. The current Windows public profile is explicitly documented and tested as unsupported with exit 10 and `CASE_E_UNSUPPORTED_PROFILE`; controlled-test earns no credit for that vector.

Final verification from the complete round-2 state:

- Focused conformance/mutation file: **49/49 passed**, 0 failed/cancelled/skipped/todo; **250813.7404 ms**.
- Full local-cache `npm --cache .npm-cache run check`: typecheck clean; **270/270 tests passed**, 0 failed/cancelled/skipped/todo; **270429.3453 ms**.
- Full-check and final standalone corpus summary: `{"total":129,"passed":129,"failed":0,"uncovered_positive":[],"uncovered_negative":[]}`.
- Static gates: schema/spec parity, exact stable ordering, unknown/unrelated binding rejection, content-normalized cross-polarity rejection, duplicate executable binding vectors **0**, and `git diff --check` clean.

Remaining external gates are unchanged and explicit: `M0-OFFLINE-008` is blocked on Task 12's bundled human help and must be flipped only after that real surface and packaging exist; production Windows is unsupported; production POSIX is unclaimed; child-process network isolation is not proven; and documentation baselines, support matrix, packaging, and independent release review remain external.
