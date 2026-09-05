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

## Fix round 3 — causal async work, exact topology, and orphan semantics

Fix round 3 started from `158ea87a33d855bd205d4881e2d624de2559dcd6`. The independent review manifest supplied with that revision is retained as review provenance, but it is not a product oracle, a coverage fact, or evidence that any rule passed. The controller's trust-boundary ruling remains unchanged: no second repository-owned assertion-to-rule allowlist was added. Coverage rests on the closed independent bindings, actually emitted facts, polarity and content-normalized duplicate checks, mutation tests, and independent release review; coordinated tampering of every repository-owned artifact remains outside the self-test claim.

Final round-3 inventory:

- Normative rules: **248** total; **228 executable** and **20 external/no-direction**.
- Required directions: **183 positive** and **181 negative**; **136 both**, **47 positive-only**, and **45 negative-only**.
- Executed cases: **139** across **18** logical families: **43 positive** and **96 negative**.
- Independent bindings: **394** case-direction entries, exactly matching **394** fixture case-rule links, with **829** clause-specific emitted-assertion links.
- Final exact corpus summary: `{"total":139,"passed":139,"failed":0,"uncovered_positive":[],"uncovered_negative":[]}`.

Round-3 RED evidence was captured before each implementation change. A timer and delayed DNS scheduled by the final assertion hook initially escaped the end-of-case check. Real `TCPSERVERWRAP` and `DNSCHANNEL` resources, and a `PBKDF2REQUEST` callback that later starts DNS, initially escaped the narrower timer-only accounting. Orphan scans initially accepted future, misaddressed, cross-dossier, self-digest-invalid, successor-invalid, and current-projection-invalid records as harmless history. A recoverable orphan initially short-circuited validation of later invalid history. A production `.keep` file was initially ignored. An `@fixture replace` reference was initially absent from the complete runtime-reference scan, and actor-label-only opposite-polarity fixtures initially had different behavior fingerprints. The first round-3 full check then exposed four regressions where damage to a referenced current submission was incorrectly promoted from the established integrity path to a generic internal scan failure; the targeted three-file integration group passed **42/42** after correcting that boundary, before the full check was rerun.

The network and unfinished-work audit now establishes an `AsyncLocalStorage` case root before repository creation, schema loading, or dependency construction and follows case-created trigger lineage through derived views, final tree/Git checks, and `onCaseAssertions`. It re-evaluates both network observations and pending work after the final assertion hook. One-shot request/work resources become quiescent after their callback, persistent handles require destroy/close, and timers or immediates remain pending until completion or cancellation. At the round-3 checkpoint, Promise resources carried causal ancestry but were not treated as unfinished I/O merely for existing; the round-4 section below narrows that boundary for unresolved case-registered continuations without treating normal runner `async`/`await` promises as pending work. A case-created network resource is immediately red; a case-created unfinished request is also red even if its callback would start the network only after the case tried to return. Tests cover delayed derived-view, final-tree, and final-assertion DNS timers without fixed sleeps, a real listening TCP server, a real resolver DNS channel, and the PBKDF2-to-DNS chain. Resolver and TCP resources created outside every case scope remain baseline resources and do not taint execution. Arbitrary child-process traffic is still outside this in-process audit and remains an explicit external limitation.

Unreferenced handoff, submission, and decision envelopes are now structurally parsed and schema-validated, then checked for repository address identity and dossier identity before classification. Handoff/submission revisions must be an exact successor pair and cannot have a future basis; submissions require an exact self-digest; decisions must resolve to a validated published submission and carry its exact digest. Current-target handoffs and submissions additionally match the current basis state digest and canonical content/check projections. Only then can a record be called recoverable or superseded. Invalid entries fail the scan closed, but every remaining envelope directory is still scanned, so an unreadable handoff directory cannot hide a submission or decision. Damage to a referenced current envelope remains represented by the existing closed envelope-integrity result; it is excluded from the history map, and any orphan decision that tries to cite it still fails closed. Historical records are validated from stored facts without pretending to reconstruct a discarded historical snapshot digest.

The corpus no longer models empty directories with placeholder files. Every fixture now declares exact `initial_directories` and `expected_final_directories`; parents must be explicitly present, the runner creates real empty directories, and the final oracle compares exact directory topology in addition to exact files and the immutable Git baseline. Production orphan scanning has no `.keep` exception. The complete runtime-reference audit includes `@fixture replace` argument 3, and a mutation replaces a reference-only file with a directory during the target probe to prove the scan executes. Behavior fingerprints omit inert `actor_label`, so a trace-label-only cross-polarity copy is rejected as behavior-identical.

The five new semantic rule families are exercised with distinct cases for filename/internal-ID mismatch, dossier mismatch, future revision, non-successor revision, submission self-digest mismatch, missing referenced submission, decision/submission digest mismatch, current basis-digest mismatch, current projection mismatch, and a valid current-target submission. Positive historical address and revision bindings assert the handoff, submission, and decision facts actually present rather than relying on a broad label.

Final round-3 verification:

- Dedicated focused conformance/mutation file against the frozen 139-case corpus: **56/56 passed**, 0 failed/cancelled/skipped/todo; **316589.9296 ms**.
- Targeted orphan evidence file: **34/34 passed**, 0 failed/cancelled/skipped/todo; **1575.8781 ms**. The final full run re-executed these tests after the current-envelope boundary correction.
- Final local-cache `npm run check`: typecheck clean; **294/294 tests passed**, 0 failed/cancelled/skipped/todo; **336938.0192 ms**.
- Full-check and final standalone corpus summary: `{"total":139,"passed":139,"failed":0,"uncovered_positive":[],"uncovered_negative":[]}`.
- Static gates: exact schema/spec parity, all runtime references resolved, exact file/directory topology, unknown/unrelated binding rejection, content-normalized and actor-normalized cross-polarity rejection, duplicate executable binding vectors **0**, and `git diff --check` clean.

Remaining external gates are unchanged: `M0-OFFLINE-008` must remain external until Task 12 provides and packages real bundled human help; production Windows remains explicitly unsupported; production POSIX remains unclaimed; arbitrary child-process network isolation is not proven; discarded historical snapshot digests cannot be re-derived; and documentation baselines, platform support evidence, packaging, and independent release review remain external.

## Fix round 4 — Promise lifecycle, cancellation, and bounded process exit

Fix round 4 started from `635f6cd124544945ff5baea8c921ac6be50ab0b9`. The controller narrowed the trust boundary after the runtime review: an unresolved case-created Promise continuation must make the case red before return, but the in-process audit is detection rather than a Promise cancellation or network sandbox. The audit hook must not remain globally installed after `runCorpus` returns. The formal conformance script, rather than the library, owns the final bounded process boundary.

The inventory is intentionally unchanged: **248** rules (**228 executable**, **20 external/no-direction**), **183** required positive and **181** required negative directions (**136 both**, **47 positive-only**, **45 negative-only**), **139** cases across **18** families (**43 positive**, **96 negative**), **394** independent binding entries, and **829** emitted-assertion links.

Round-4 RED evidence was captured at each changed lifecycle boundary. A `.then(() => dns.lookup(...))` continuation registered on a pre-existing unresolved Promise initially let its target case pass (`true !== false`). A timer created and immediately cancelled in `onCaseAssertions` initially made an otherwise clean case fail (`false !== true`). A real listening `net.Server` initially remained active after a red case returned (`true !== false` for the expected inactive state), with the test retaining temporary cleanup only long enough to record that RED.

The audit now tracks unresolved Promise resources created in the case scope, while explicitly excluding the still-running corpus body and current runner continuation. The Promise mutation receives its red summary while the gate is still unresolved, then performs a second complete clean run against the same corpus and obtains **139/139** before the gate is released; this demonstrates no observable cross-run contamination. Hook teardown itself is an unconditional code path inspected by this review and remains part of the independent review boundary; no production bypass or hook-introspection port was added. The test finally resolves the gate and lets its DNS callback complete, but neither implementation nor report claims that `runCorpus` cancels the Promise or audits/sandboxes that later side effect after return.

At the round-4 checkpoint, cancellation was inferred from the handle's private `_destroyed` field rather than elapsed time. Round 5 below removes that forgeable signal entirely and replaces it with the runtime lifecycle notification after a deterministic event-loop checkpoint.

Cleanup remains deliberately narrow. Pending case-created `Timeout` and `Immediate` resources are cancelled, `TCPSERVERWRAP` is closed through its owning server, and `DNSCHANNEL` is cancelled. The final Server test no longer closes the case-created server in its hook, assertion, or teardown and proves it is not listening when `runCorpus` returns. The Resolver test sends a real pending query to a UDP sink created outside case scope and observes exact `ECANCELLED`; teardown closes only that baseline sink. Unknown resource types still make the case red and are not claimed to be safely cleanable. The formal script writes stderr/stdout synchronously and calls `process.exit` with the computed status, so an unknown active handle cannot keep the official conformance process alive after its exact result is emitted.

Section 22.1 and `M0-CORPUS-011` now state the same boundary: unresolved case-registered Promise continuations and runnable timers are pending work, synchronously cancelled timers/immediates are not, hooks are disabled before the library returns, cleanup is limited to known resources, and the audit is detection rather than a sandbox. Child-process traffic remains outside the in-process audit.

Final round-4 verification:

- Focused network/lifecycle mutation group: **12/12 passed**, 0 failed/cancelled/skipped/todo; **129729.6433 ms**.
- Dedicated focused conformance/mutation file: **58/58 passed**, 0 failed/cancelled/skipped/todo; **347747.0651 ms**.
- Final local-cache `npm run check`: typecheck clean; **296/296 tests passed**, 0 failed/cancelled/skipped/todo; **310287.8878 ms** for the test phase, followed by a successful standalone conformance run.
- Final exact standalone corpus summary: `{"total":139,"passed":139,"failed":0,"uncovered_positive":[],"uncovered_negative":[]}`.
- Static gates: spec/ledger parity for the lifecycle contract, stable counts and bindings, and `git diff --check` clean.

Remaining limits are unchanged and explicit: the library cannot cancel arbitrary Promises or safely close arbitrary unknown Node resources; network side effects after a failed call returns are not sandboxed; arbitrary child-process traffic is not observed; `M0-OFFLINE-008` remains external until Task 12 bundles real human help; Windows remains explicitly unsupported; production POSIX remains unclaimed; and documentation baselines, platform support evidence, packaging, and independent release review remain external gates.

## Fix round 5 — public lifecycle evidence and registered Promise continuations

Fix round 5 started from `14a81670213e9298f42b2601bf59e422ab4c0a11`. The inventory remains frozen at **248** rules (**228 executable**, **20 external/no-direction**), **183** required positive and **181** required negative directions, **139** cases (**43 positive**, **96 negative**) across **18** families, **394** independent binding entries, and **829** emitted-assertion links.

Two independent REDs exposed the remaining runtime overclaims. A bare `new Promise(() => {})` with no registered continuation made a clean case fail (`false !== true`), showing that unresolved Promise existence was too broad. A live 50 ms DNS timer whose private `_destroyed` property was forged to `true` made its target case pass (`true !== false`), showing that the private field was not a trustworthy cancellation oracle. Honest `clearTimeout` and `clearImmediate` remained green during the RED run.

Promise classification now uses Node 24's public `node:v8` promise lifecycle hook. Its `init(promise, parent)` callback identifies a Promise created for a real continuation by the presence of the runtime-supplied parent Promise; the same Promise object is then correlated with the async-hooks resource through a `WeakSet`. Only an unresolved, case-scoped, parent-bearing continuation is pending, with the currently executing runner continuation and corpus body excluded. A bare unresolved Promise has no parent and is inert for this audit. The gate `.then(() => dns.lookup(...))` mutation remains red, the bare-Promise vector is green, and the normal 139-case async/await corpus remains green. Both lifecycle hooks are stopped unconditionally in `finally`; the clean second run demonstrates no observable cross-run contamination, while actual hook teardown remains code-inspected and within the independent-review boundary rather than exposed through a production introspection or bypass port.

Timer liveness no longer reads `_destroyed` or any other mutable private field. After final assertions, the runner performs one deterministic `setImmediate` lifecycle checkpoint under a separate audit-infrastructure `AsyncLocalStorage` scope. Only resources causally created by that checkpoint are excluded; a case timer firing during the checkpoint retains the case scope and its network work remains observable. Publicly cancelled timeout/immediate resources deliver their async-hooks `destroy` notification by the checkpoint and leave the pending set, while a live delayed timer remains pending and turns the case red. No elapsed-time grace period or fixed sleep was introduced.

For bounded cleanup, the runner captures each Timeout's public numeric primitive synchronously in async-hooks `init`, before the creating hook receives and can alter the handle, and retains the cancellation functions before any case callback runs. Final cleanup uses that captured token, so forging `_destroyed` cannot suppress cancellation. The mutation observes the exact public cleanup boundary; honest timeout and immediate cancellation both pass. Existing known cleanup remains unchanged for `TCPSERVERWRAP` and `DNSCHANNEL`, and the formal script retains synchronous output plus explicit process exit. Unknown resources remain red without any broader cleanup or sandbox claim.

Section 22.1 now states the narrowed contract: bare Promises are not pending, registered unresolved continuations are pending, timer/immediate liveness is sampled after a deterministic non-timed lifecycle checkpoint, and mutable private handle fields carry no authority. `M0-CORPUS-011` already used the narrower “case-registered Promise continuation” language, so its ID, direction, and binding did not change.

Final round-5 verification:

- Focused network/lifecycle mutation group: **14/14 passed**, 0 failed/cancelled/skipped/todo; **135075.9014 ms** within the final full-check rerun.
- Dedicated focused conformance/mutation file: **60/60 passed**, 0 failed/cancelled/skipped/todo; **392416.2873 ms**.
- Final local-cache `npm run check`: typecheck clean; **298/298 tests passed**, 0 failed/cancelled/skipped/todo; **344939.6349 ms** for the test phase, followed by a successful standalone conformance run.
- Final exact standalone corpus summary: `{"total":139,"passed":139,"failed":0,"uncovered_positive":[],"uncovered_negative":[]}`.
- Static gates: no production `_destroyed` reference, lifecycle spec/ledger parity, stable corpus/binding counts, and `git diff --check` clean.

Remaining limits are unchanged: `runCorpus` detects but does not cancel arbitrary Promises or sandbox post-return effects; promise-parent and timer-token behavior is supported only for the pinned Node 24 runtime; unknown Node resources are not claimed safely cleanable; child-process traffic remains outside the in-process audit; `M0-OFFLINE-008`, platform support, documentation baselines, packaging, and independent release review remain external gates.

## Fix round 6 — cleanup ownership, final-state revalidation, and runtime preflight

Fix round 6 started from `d4e9874acaa550d4d1216e8d884fb64c9454d38f`. The normative inventory and frozen corpus remain unchanged at **248** rules (**228 executable**, **20 external/no-direction**), **183** required positive and **181** required negative directions (**136 both**, **47 positive-only**, **45 negative-only**), **139** cases across **18** families (**43 positive**, **96 negative**), **394** independent binding entries, and **829** clause-specific assertion links.

The cleanup-ownership RED poisoned the Timeout prototype's `Symbol.toPrimitive` and replaced the global `clearTimeout` from `onCaseStart`. The case itself was correctly red, but the old numeric-token/global capture path destroyed the unrelated baseline timer and left the case timer without a destroy event (`true !== false` at the baseline-liveness assertion). Cleanup now uses module-loaded `node:timers` cancellation functions and passes the actual async resource object; it performs no numeric coercion and is not redirectable by a runner port. The exact mutation proves that the baseline timer remains live and the case timer is cancelled. The numeric-token mechanism described in round 5 is historical and is superseded by this result.

Three independent final-hook REDs wrote an unexpected repository file synchronously, through `process.nextTick`, and through a microtask after the first oracle snapshot; all three incorrectly retained a passing case (`true !== false`). After `onCaseAssertions` and one isolated lifecycle checkpoint, the runner now re-evaluates exact outcomes, executes a second read-only derived `show`, compares the harness-owned Git baseline, and compares the final repository tree. It discards the earlier fact set and rebuilds binding assertions only from this second evaluation before returning or granting coverage. A clause-specific `.git/config` mutation was additionally run against a deliberate Git-recheck-disabled mutant: only that child turned red, and restoring the final Git comparison returned all four late-state variants to green.

The other port-visible observations were re-audited as part of the same boundary. Invocation results are detached scalar copies, final-tree output is a detached object, prompts are strings, and assertion IDs are a fresh array; ports never receive the internal outcomes, operation facts, or traces. The corpus itself retains its independent whole-tree before/after comparison. Repository-backed outcomes, views, trees, and Git state are therefore the mutable authoritative observations and are all recomputed after the port returns.

A completed benign Immediate happened to receive a normal Node destroy notification before the old sampler, so the unmutated runtime initially masked the missing one-shot rule. Suppressing that destroy notification as a mutation made the benign case red (`false !== true`) while an Immediate-created child timer remained red. Treating Immediate as callback-complete in `after` made the benign case green even under that mutation; child resources inherit case causality during `init` before the parent is removed, so both the child-timer mutation and the existing child-network mutation remain red.

Node support is now capability-gated rather than inferred from a broad semver label. Before corpus loading, a fail-closed preflight verifies that a bare Promise has no reported parent, that a registered continuation reports its exact parent on the same Promise object observed by `async_hooks`, that public timeout/immediate cancellation is followed by destroy at the deterministic checkpoint, and that a completed Immediate receives `after`. Two subprocess mutations respectively remove the continuation parent and invent a parent for a bare Promise before importing the runner; both receive the exact stable conformance failure before any case can earn credit. The trusted Promise-hook constructor is captured at module initialization; a separate port mutation proved that replacing the mutable `promiseHooks.createHook` property after preflight can no longer hide an unresolved case continuation. Only Node **24.19.0** was measured in this task; other Node 24 releases are admitted only if they pass the runtime preflight and are not claimed pre-verified.

The audit boundary is otherwise unchanged: no fixed sleep was added; known cleanup remains bounded; arbitrary Promises and unknown resources are not claimed cancellable; post-return effects are not sandboxed; and child-process traffic remains outside the in-process network audit.

Final round-6 verification:

- Round-6 cleanup/final-state/Immediate/capability checks: **11/11 passed** within the complete focused run, with 0 failed/cancelled/skipped/todo.
- Existing async/network mutation group: **14/14 passed**, 0 failed/cancelled/skipped/todo; **190246.5995 ms** in the final full check.
- Dedicated focused conformance/mutation file: **71/71 passed**, 0 failed/cancelled/skipped/todo; **447655.4174 ms**. The final full check re-executed the whole file after the additional bare-Promise capability mutation.
- Final local-cache `npm run check`: typecheck and build clean; **309/309 tests passed**, 0 failed/cancelled/skipped/todo; **522326.6083 ms** for the test phase, followed by a successful standalone conformance run.
- Final exact standalone corpus summary: `{"total":139,"passed":139,"failed":0,"uncovered_positive":[],"uncovered_negative":[]}`.
- Static gates: no production `_destroyed`, numeric timer coercion, fixed sleep, or runner bypass port; lifecycle prose/test parity and frozen rule/case/binding counts; `git diff --check` clean.

Remaining external limits are unchanged: `M0-OFFLINE-008`, production platform support, documentation baselines, packaging, and independent release review remain external gates. In-process detection does not cancel arbitrary Promises, sandbox post-return work, clean arbitrary unknown resources, or observe child-process traffic.
