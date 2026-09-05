# SDD ledger — plan: docs/superpowers/plans/2026-09-04-m0-local-dossier-integrity.md

Branch base: `31b366e`
Workspace: `D:/MyProject/C.A.S.E._Framework/.worktrees/m0-local-dossier-integrity`

Ruling: The bundled Bash SDD helper cannot start because WSL returns `E_ACCESSDENIED`; reproduce its deterministic `.superpowers/sdd/<plan>/` paths and artifacts with PowerShell — this costs portability of the controller procedure on this machine, but does not change or enter the product implementation.

## Pre-flight task/interface scan

| Producer | Consumer | Shared file or interface | Finding |
|---|---|---|---|
| Task 1 | Tasks 2–12 | Node/TypeScript build and test shell | Consistent; later tasks extend the scaffold. |
| Task 1 | Task 10 | `src/cli/main.ts` | Consistent; Task 10 replaces the smoke-only adapter with the approved command router. |
| Task 1 | Task 11 | `package.json`, `package-lock.json`, scripts | Consistent; Task 11 extends scripts and refreshes the lock only if metadata changes. |
| Task 1 | Task 12 | package `files` allowlist and `README.md` | Consistent; README is intentionally created before the first pack gate. |
| Task 2 | Tasks 3–10 | protocol types, errors, result envelope | One type correction required: artifact size is a decimal string, not semantically a revision. See ruling below. |
| Task 3 | Tasks 4–11 | strict parser, schemas, offline registry | Consistent; conformance schemas added in Task 11 are corpus metadata, not governed dossier artifacts. |
| Task 4 | Tasks 6–9, 11 | canonical projections and digests | Consistent; explicit projections prevent later workflow fields entering digests accidentally. |
| Task 5 | Tasks 6–11 | repository root, safe evidence paths, store | Consistent; root discovery must recognize both `.git` directories and linked-worktree `.git` files. |
| Task 6 | Tasks 7–11 | guarded mutation and atomic publication | Consistent if the Windows profile documents the actual single replace primitive and claims support only after corpus proof. |
| Task 7 | Tasks 8–11 | dossier/evidence/check/show transitions | Consistent; ordinary evidence mutations retain envelope pointers and derive staleness. |
| Task 8 | Tasks 9–11 | current handoff and active-run authority | Consistent; submission refuses an unaccepted current offer. |
| Task 9 | Tasks 10–12 | submission, decisions, current acceptance | Consistent; decision-pointer publication is excluded from checks/submission digests. |
| Task 10 | Tasks 11–12 | built CLI and stable process envelopes | Consistent; corpus drives only the approved surface. |
| Task 11 | Task 12 | corpus results and supported-profile evidence | Consistent; README claims are bounded by recorded corpus output. |
| Task 1 | Task 1 | smoke test, version, package metadata | Internally consistent after plan review aligned all version strings to `0.1.0-preview`. |
| Task 2 | Task 2 | scalar types and error/result tests | Internally consistent with the decimal-string ruling below. |
| Task 3 | Task 3 | parser negatives and closed-schema registry | Internally consistent; duplicate-key fixture uses booleans so it reaches the intended rule. |
| Task 4 | Task 4 | JCS and projection mutation tests | Internally consistent; Unicode order is UTF-16 code-unit order and arrays retain stored order. |
| Task 5 | Task 5 | init confinement and path resolution | Internally consistent with `.git` file/directory recognition noted above. |
| Task 6 | Task 6 | races, guards, publication faults | Internally consistent; race loser may legally be busy or conflict. |
| Task 7 | Task 7 | create/add/check/show | Internally consistent; human-review-required can coexist with a passed mechanical verdict. |
| Task 8 | Task 8 | offer/accept and stale cases | Internally consistent; accepted status remains terminal for that offer. |
| Task 9 | Task 9 | submission/decision/staleness | Internally consistent; filesystem byte changes can stale a view without changing stored revision. |
| Task 10 | Task 10 | parsing/rendering/process tests | Internally consistent; JSON mode uses stdout-only machine envelopes after mode detection. |
| Task 11 | Task 11 | rule ledger, runner, 14 fixture families | Internally consistent after plan review added a reusable runner module and exact coverage accounting. |
| Task 12 | Task 12 | frozen baseline, report, README, pack gate | Internally consistent; baseline/evaluation JSON is measurement metadata, not governed protocol state. |

Ruling: Introduce a `DecimalString` scalar and define `Revision` from it; use `DecimalString` for `artifact_size` — this preserves wire format while preventing revision semantics from leaking into file sizes; if wrong, the cost is a small public type rename before preview.

Ruling: Treat conformance fixtures and baseline result records as test/evaluation metadata parsed against their own closed schemas, not as governed instance JSON — otherwise their specified integer exit codes and burden metrics contradict the protocol's number-free governed state; if wrong, fixture schemas and runner serialization must be migrated to decimal strings.

Ruling: Root discovery accepts an owning `.git` directory or linked-worktree `.git` file, but does not interpret arbitrary foreign `.git` content as trusted ownership — if wrong, nested/linked worktree discovery fixtures will require a narrower adapter rule.

Ruling: On Windows, document and test the exact libuv/Node primitive used by `fs.rename`/replacement and withhold Windows-profile support if it does not satisfy the frozen failure corpus — this avoids adding an unplanned native dependency; if wrong, Task 6 will need a Windows-native adapter dependency before that profile can be claimed.

Next: Task 1.

Baseline: branch `feat/m0-local-dossier-integrity` at `31b366e`; worktree clean; no package manifest or executable test suite exists yet, so project setup and the intentional red smoke run begin in Task 1.
Task 1 base: `31b366e`.

Task 1: Ruling: The original RED was blocked before the runner by the host npm-cache permission, so accept the explicitly labeled post-implementation mutation/reversion RED as proof that the smoke test detects the absent executable, while preserving the chronological limitation in the report — this costs process-level TDD confidence for Task 1 but does not leave an untested product behavior.
Task 1: complete (commits `31b366e..1d208c4`, review clean; one non-blocking evidence limitation resolved by the ruling above).
Next: Task 2.

Task 2: minor (deferred): tests cover one mapping/failure envelope but not the complete mapping table, success envelope, or compile-time evidence/status constraints; final review must triage whether Task 3 schema tests and later workflow tests close this affordably.
Task 2: Ruling: strengthen `Digest`, `DecimalString`, and `Revision` into separate branded values with validating constructors now, despite the brief's permissive template literal examples, because the spec defines exact wire grammars and the controller ruling requires semantic separation; Task 3 must reuse rather than duplicate these validators — this costs a slightly larger scalar API in Task 2 if schema-only validation would have sufficed.
Task 2: fix round 1 base: `3aaea77`.

Task 2: fix round 1/5 (1 addressed, 0 open; commits `3aaea77..4cdfbbb`).
Task 2: cannot-verify item resolved: whole-program offline/no-telemetry behavior was already inspected in Task 1 and Task 2 adds only types/tests plus test configuration; no new runtime I/O path exists.
Task 2: complete (commits `1d208c4..4cdfbbb`, review clean; one deferred minor retained for final review).
Next: Task 3.

Task 3: minor (deferred): UTC timestamp validator rejects RFC 3339 leap-second values; final review must decide whether to support them or explicitly narrow the timestamp profile.
Task 3: minor (deferred): `result.schema.json` duplicates the stable error-code enumeration across branches; final review should triage a shared `$defs` source.
Task 3: Ruling: bound governed JSON nesting at 256 containers and return stable `CASE_E_PARSE` beyond it — this prevents native stack exhaustion at the cost of rejecting otherwise syntactically valid protocol documents deeper than any M0 state shape requires.
Task 3: fix round 1 base: `7dbc24c`.

Task 3: fix round 1/5 (2 addressed, 0 open; commits `7dbc24c..4a0e0ff`).
Task 3: complete (commits `4cdfbbb..4a0e0ff`, review clean; two deferred minors retained for final review).
Next: Task 4.

Task 4: Ruling: model invariant observations with an internal closed `CheckStage` (`parse`, `schema`, `cross_file`, `evidence_safety`, `evidence_integrity`, `envelope_integrity`, `derived_status`) and sort by that rank then ASCII code, while omitting `stage` from the canonical checks projection — this makes the spec's two-level order executable at the cost of one internal field later check producers must supply.
Task 4: fix round 1 base: `617430a`.

Task 4: fix round 1/5 (1 addressed, 1 open — observed-evidence top-level mutation and all evidence-variant `captured_at` coverage incomplete; commits `617430a..670cfd4`).
Task 4: fix round 2 base: `670cfd4`.

Task 4: fix round 2/5 (0 fully addressed, 1 open — discriminator sensitivity not proven for every evidence variant; commits `670cfd4..b3eaa93`).
Task 4: fix round 3 base: `b3eaa93`.

Task 4: fix round 3/5 (1 addressed, 0 open; commits `b3eaa93..43cc80c`).
Task 4: complete (commits `4a0e0ff..43cc80c`, review clean).
Next: Task 5.

Task 5: minor (deferred): thrown `createTemporaryId()` can escape the result-envelope boundary; final review must require stable conversion if the revised init flow still calls an injected ID provider.
Task 5: Ruling: the spec's “only `.case-agent/`” invariant overrides the plan's sibling-staging instruction. Create `.case-agent/` exclusively, populate only beneath it, and write validated `manifest.json` last as the completion marker; failure cleanup is best effort but any residue stays inside the owned namespace and is a fail-closed partial collision on retry — this costs all-or-nothing directory publication and may require manual recovery after a crash.
Task 5: Ruling: do not infer a supported filesystem profile from `process.platform`; require an injected positive capability classification and let the bundled Node-only adapter return unsupported when it cannot prove generic Windows reparse/remote-volume safety — this costs out-of-box initialization until a proven platform adapter is supplied, but prevents a false Windows support claim.
Task 5: fix round 1 base: `060d035`.

Task 5: fix round 1/5 (4 addressed, 0 open; commits `060d035..8cd8a99`).
Task 5: complete (commits `43cc80c..8cd8a99`, review clean; one deferred minor retained for final review).
Next: Task 6.

Task 6: minor (deferred): `after_temp_open` fault currently fires only after complete write/close, so it does not exercise partial-write interruption.
Task 6: minor (deferred): unexpected pre-publication adapter exceptions can retain a writer lock while returning `CASE_E_INTERNAL` rather than recovery-required.
Task 6: Ruling: distinguish recoverable pre-pointer failure from process crash. A controlled failure after immutable-envelope create but before snapshot replace releases the still-owned writer guard and permits same-basis orphan retry; an actual dead-process stale guard requires formal recovery, whose no-op revision invalidates all pre-recovery operations and leaves their orphan envelopes non-authoritative — this costs automatic completion of an orphan after crash but preserves the spec's recovery revision barrier.
Task 6: Ruling: existing envelope reuse requires a caller-supplied, kind-specific full semantic validator over every deterministic and digest-bound field; generic storage may not infer partial equivalence — this costs a required validator implementation in Tasks 8 and 9 but prevents foreign valid-schema envelopes becoming authoritative.
Task 6: fix round 1 base: `3edc5d5`.

Task 6: fix round 1/5 (6 addressed, 0 open; commits `3edc5d5..0b64306`).
Task 6: complete (commits `8cd8a99..0b64306`, review clean; two deferred minors retained for final review).
Next: Task 7.

Task 7: minor (deferred): `evidence.add` returns `command: mutation` on guarded success/retry/failure paths; final review must normalize public command identity without weakening generic storage envelopes.
Task 7: Ruling: when current state/schema/cross-file/envelope integrity is invalid, the sole safe next-action code is `CASE_NEXT_INSPECT_STATE`, a non-mutating human escalation rather than a command that would necessarily fail; evidence-only failures may use `CASE_NEXT_ADD_EVIDENCE` — this costs adding one stable current-view action code but prevents impossible recommendations.
Task 7: fix round 1 base: `6044f5d`.

Task 7: fix round 1/5 (3 addressed, 0 open; commits `6044f5d..d0028a7`).
Task 7: complete (commits `0b64306..d0028a7`, review clean; one deferred minor retained for final review).
Next: Task 8.

Task 8: fix round 1 base: `a40ccb9`.

Task 8: fix round 1/5 (1 addressed, 0 open; commits `a40ccb9..8eaf633`).
Task 8: complete (commits `d0028a7..8eaf633`, review clean).
Next: Task 9.

Task 9: fix round 1 base: `51144d8`.

Task 9: fix round 1/5 (1 addressed, 1 open — decision still checks non-current submission conflict before structural invariants; commits `51144d8..7e92f8f`).
Task 9: fix round 2 base: `7e92f8f`.

Task 9: fix round 2/5 (1 addressed, 0 open; commits `7e92f8f..85f00b7`).
Task 9: complete (commits `8eaf633..85f00b7`, review clean).
Next: Task 10.
Task 10: Ruling: keep production Windows mutation fail-closed because the Node adapter does not prove the required atomic replacement profile; exercise the complete semantic CLI journey only through explicit in-process dependency injection, never a normal executable flag or environment backdoor — this costs a successful shipped Windows mutation journey in M0 but avoids a false safety claim.
Task 10: Ruling: add a stable `CASE_E_UNSUPPORTED_PROFILE` environment-family error mapped to exit 10 before freezing conformance; expected absence of a proven platform profile is not an unexpected internal failure — this costs one protocol/schema expansion but preserves actionable and honest machine semantics.
Task 10: Ruling: `guard recover` is a governed existing-dossier mutation despite its exceptional lock path. Its public request must retain operation ID and an exact expected snapshot basis; human mode obtains that basis in the same invocation, and recovery rechecks it only after exclusive recovery-guard acquisition — this costs extending Task 6's recovery interface but prevents intent rebinding and discarded correlation.
Task 10: fix round 1 base: `d677231`.

Task 10: fix round 1/5 (8 addressed, 1 open — successful recovery identical retry is not idempotent; commits `d677231..9a5503b`).
Task 10: fix round 2 base: `9a5503b`.

Task 10: fix round 2/5 (1 addressed, 0 open; commits `9a5503b..5dca6ce`).
Task 10: complete (commits `85f00b7..5dca6ce`, review clean).
Next: Task 11.
Task 11: Ruling: deterministic controlled ports are a conformance test profile, not a claimed production platform profile; corpus success proves the protocol oracle and implementation semantics under injected capabilities but does not make Windows or another production filesystem supported — this costs satisfying the release support-matrix gate in M0, so the preview remains not releasable until a real adapter passes the same corpus.
Task 11: Ruling: update normative spec §17 to include the controller-approved `CASE_E_UNSUPPORTED_PROFILE` environment family before re-freezing its ledger; this is reconciliation of an earlier protocol decision, not an implementation-result rewrite — this costs a spec edit in the conformance fix but removes a real normative contradiction.
Task 11: Ruling: a positive/negative direction earns coverage only from materially distinct behavior and clause-specific assertions; directory polarity and a probe-authored ID allowlist are insufficient evidence — this costs splitting compound rules/probes and increasing the corpus, but prevents structurally green self-certification.
Task 11: fix round 1 base: `9cb67f3`.

Task 11: fix round 1/5 (prior concrete runtime/polarity/probe/platform faults addressed; remaining actionable contract/render/network/orphan/device/environment items open; commits `9cb67f3..1907e2c`).
Task 11: Ruling: structural tooling cannot prove logical entailment when an adversary jointly edits a rule, fixture, binding, assertion implementation, and expectations; the executable oracle enforces independent closed bindings, emitted clause-specific assertions, polarity distinction, zero duplicate vectors, exact outputs/trees/views, and mutation-red behavior, while semantic sufficiency remains an explicit independent human release-review gate — this costs making the corpus tamper-proof against coordinated source edits, which is impossible without an external trust root, but avoids adding another self-certified allowlist disguised as proof.
Task 11: Ruling: extend §22.1 deliberately with exact stderr and a frozen stderr reference so interactive prompts are first-class conformance evidence; this is a normative fixture-contract correction discovered by review, not silent schema drift.
Task 11: fix round 2 base: `1907e2c`.

Task 11: fix round 2/6 (contract/render/network/orphan/device/environment gaps addressed; commits `1907e2c..158ea87`; independent review found final-hook and broader async/history gaps).
Task 11: Ruling: the zero-network oracle must treat case-created delayed resources as causal work rather than draining an arbitrary number of event-loop turns; baseline/test-runner resources remain outside the case scope, and child-process traffic remains explicitly unproven.
Task 11: Ruling: an envelope is classified as recoverable current publication or superseded history only after its address identity, dossier identity, revision direction, digest/basis coherence, and referenced envelope relations validate; future or semantically inconsistent records fail closed.
Task 11: fix round 3/6 (async causality, semantic orphan validity, `.keep`, runtime references, and inert fingerprint data addressed; commits `158ea87..635f6cd`; independent review found Promise/timer lifecycle gaps).
Task 11: Ruling: conformance async auditing is a detection oracle, not a sandbox or arbitrary Promise cancellation mechanism. Pending case-registered continuations make a case fail, but the library must tear down its hooks before returning; the formal process boundary guarantees bounded exit.
Task 11: fix round 4/6 (Promise pending detection, public cancellation semantics, known-resource cleanup, and bounded script exit addressed; commits `635f6cd..14a8167`; independent review rejected private `_destroyed` trust and overbroad Promise classification).
Task 11: Ruling: private or fixture-writable runtime fields cannot certify cancellation. Cancellation and liveness evidence must come from public runtime lifecycles, and inert bare Promises must not be confused with registered continuations.
Task 11: fix round 5/6 (Promise-parent correlation and public timer lifecycle checkpoint addressed; commits `14a8167..d4e9874`; independent review found cleanup ownership and stale final-state checks).
Task 11: Ruling: trusted cleanup functions are captured from public Node modules before any fixture port, operate on the actual case-created resource object, and may clean only known owned resources; unknown resources still fail the oracle without a cleanup claim.
Task 11: Ruling: final assertion hooks are part of the mutation surface. After their causal microtasks and immediates reach a deterministic lifecycle checkpoint, every state-dependent oracle is re-read and only the second verification may earn rule coverage.
Task 11: Ruling: Node 24 support is capability-gated rather than inferred from a broad version string. Only Node 24.19.0 is measured here; another Node 24 runtime must pass the fail-closed Promise-parent, cancellation/destroy, and Immediate-completion preflight.
Task 11: fix round 6/6 (resource ownership, final-state revalidation, completed Immediate, and runtime capability preflight addressed; commits `d4e9874..55c8c47`).
Task 11: complete (commits `5dca6ce..55c8c47`; independent runtime/security and spec/traceability reviews clean; 309/309 full tests, 139/139 corpus, zero skip/todo and no uncovered direction).
Next: Task 12.
