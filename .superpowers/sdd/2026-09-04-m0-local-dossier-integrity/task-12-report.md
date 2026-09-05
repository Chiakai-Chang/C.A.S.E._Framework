# Task 12 report — baseline evidence and preview boundary

## Outcome

Task 12 records the frozen four-case protocol, 34 immutable attempt records across r1-r4 and r6, one disclosed failed r5 persistence attempt with no fabricated result, bounded preview help/README, package boundary, and alignment decision. The decision is `narrow`: no feature expansion until a real production adapter passes the corpus and enables a valid M0 rerun.

## Commits before results

- `c7e1e083065e62956055286c03b4bd8564e729d2` — frozen protocol/cases/schema plus Task 11 provenance.
- `ca6ea1dcb54b665568b40fb04e63b7a8ab57e13a` — public offline help and executable conformance binding.
- `6f8228ca2c01688e9c484ea50f63cd0c90f59259` — r2 runner recorded after execution; explicitly post-pilot.
- `ea43b39bb89bdf995037b73bb9ffa2f78cc0d032` — concurrent-writer runner recorded after r3 execution; explicitly post-pilot.
- `3b8be9dcaa96ca43d5ff99efbba5e23dbdf3b67d` — r4 method, runner, schema, semantic validator, and cases frozen before execution.
- `bdafa3f4456578cd0bf5a64fdf1f111088586491` — eight immutable r4 outcomes committed after execution.
- `d39dce25393d83fdf1829b344920274d0ff86e83` — r5 model-command, provenance, integrity, and process-boundary method frozen before execution.
- `dc4501cd111e47abc579dda514faa8760159d6bd` — failed r5 persistence incident recorded before repair.
- `09a96bc84c013b5e4d586aa4270a922f6a6e9fea` — r6 atomic storage amendment frozen before replacement execution.
- `15778ffc77c9c1fe834fab810f5f71021dfc2c9c` — eight immutable r6 outcomes.

## TDD record

1. Public `--help` process test failed with exit 2 because no help surface existed.
2. Static bundled help was added before platform dependency construction; focused process test passed.
3. `M0-OFFLINE-008` was made required; conformance reported `uncovered_positive:["M0-OFFLINE-008"]`.
4. A public-process help probe, closed case, and independent binding were added; conformance became 140/140 with no uncovered direction.
5. The fresh full suite later exposed a hard-coded 139 corpus count after the new case. Root cause was the exact stale count assertion; changing it to 140 is covered by the already-red test.

## Evaluation

See `docs/evaluation/m0-baseline-report.md` and schema-valid per-run records under `evaluation/markdown-baseline/results/`.

- r1: eight retained invalid records (non-identical fixture revisions; B0 verdict truncation).
- prior B0 aggregate withdrawn: independent review invalidated r3 because evaluator-created disconnected commits did not implement two model-directed writers or shared publication, and the raw actor responses needed to reproduce manual grading were not retained.
- r4: retained raw but externally invalidated for placeholder provenance and incomplete runner process boundary.
- method-frozen r6 B0: 4/4 detected, 0/4 false success; 35 trace events comprising 32 actor commands and 3 evaluator injections; 235,693 ms; 34,925 input and 5,851 output tokens; exact privacy-safe actor outputs and versioned adjudication retained.
- paired r6 M0: four invalid production Windows outcomes at init; 4 commands; 2,276 ms; tokens unavailable; no controlled-test substitution.
- user decisions, corrections, and recovery steps: zero in selected observations.

The authorized server was started from the unmodified batch for each evaluation window. In round two, exact processes 44520 (failed r5 attempt) and 23168 (r6 replacement) were verified against the configured executable path and stopped; port 8080 was confirmed closed after r6. Pi, server configuration, and model files were not changed.

## Exact verification commands and results

- `npm.cmd --cache .npm-cache ci` — failed before install because the user's roaming npm copy lacks `npm-bundled`.
- `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" --cache .npm-cache ci` — success, 9 packages.
- direct bundled npm `run typecheck` — success, zero errors.
- first direct bundled npm `test` — 310 tests, 308 passed, 2 failure entries caused by one stale expected total (139 versus 140); this was the expected red evidence for the count correction.
- fresh direct bundled npm `run check` after the fix — typecheck passed; 310 tests passed with zero failures, skipped, or todo; conformance passed 140/140 with no uncovered direction.
- final direct bundled npm `run check` after r4 — typecheck passed; 310/310 core tests and 15/15 offline evaluation tests passed with zero failures, skipped, or todo; conformance passed 140/140 with no uncovered direction.
- final direct bundled npm `run check` after r6 — typecheck passed; 310/310 core tests and 27/27 evaluation tests passed with zero failures, skipped, or todo; conformance passed 140/140 with no uncovered direction.
- direct bundled npm `run conformance` after the fix — 140 total, 140 passed, 0 failed, no uncovered direction.
- AJV 2020 plus semantic validation of every committed result — 34 total, 34 valid, 0 invalid; recursive external integrity manifest 34/34 with no set/digest/blob/first-commit/status/protocol mismatch.
- final direct bundled npm `pack --dry-run --json` — 86 entries; 143,799 packed bytes; 778,110 unpacked bytes; shasum `13f071f42efc3c403642376f695bcd717846e6ea`; prohibited categories absent.
- `git diff --check 55c8c47cb7639c4106af6016f41ce8c4c3c6afc7..HEAD` — clean after removing seven historical EOF blank lines.

## Package file list

The exact compressed list is README and package metadata; nine named schemas; and the `.d.ts`, `.js`, `.js.map` triplet for 5 CLI, 1 conformance, 9 protocol, 4 storage, and 6 workflow modules. The expanded module names and package statistics are recorded in the baseline report.

## Remaining limitations

- Windows production mutation unsupported; POSIX unclaimed.
- M0 production baseline invalid and therefore cannot satisfy the advance gate.
- r2/r3 are post-pilot amendments, not preregistered samples.
- r3 is retained but method-invalid and cannot be selected as comparative evidence; r4 replaces only the post-pilot observation, not the old record.
- r6 is post-pilot evidence rather than a preregistered comparison; M0 remains wholly invalid, so the decision remains `narrow`.
- Controlled-test conformance is not production support.
- Independent whole-branch review remains a controller gate; Task 12's full check, package dry-run, result-schema validation, and diff/status accounting are complete.

## Fix round 3

Commit `45204acb0f8cebd6afb43d9a8d43934d098b6ea4` adds case-specific deterministic adjudication, absolute per-case deadlines, typed timeout retention, final point-in-time verifier re-reading, closed evaluator Git/CLI execution, and explicit process-containment limits. All four immutable r6 B0 records reproduce their claimed detection, so no new model execution or outcome record was created. Derived burden is 35 trace events: 32 actor commands and 3 evaluator injections. The frozen runner was renamed from the stale `run-r4.mjs` label to `run-evaluation.mjs`; immutable old trace strings were not rewritten.

Final round-three check passed 310/310 core tests, 32/32 evaluation tests, and 140/140 conformance cases. The final cooperative point-in-time integrity verification retained 34/34 records with no failure; package contents remain 86 allowlisted files.

## Fix round 4

This is post-result runner hardening only: no raw record was changed and no model was run. Future live B0 records pass the case-specific deterministic adjudicator before atomic persistence and terminal summary; an ungrounded `DETECTED` is retained as a failed, zero-credit record with exact actor output and the adjudication reason. Immutable r6 qualifies only through the external post-hoc re-adjudication recorded after execution.

The same absolute ten-minute case deadline now covers fixture setup and all injection steps as well as actor turns, child commands, and publication-gate waiting. Single-actor usage is accumulated into partial state after every completed model response so a later failure retains available usage. Evaluator Git uses a minimal newly built environment, ignores system/global configuration, disables hooks/signing/credentials/pagers and executable diff/text-conversion helpers, and invokes diff with `--no-ext-diff --no-textconv`; this narrows inherited-process surprises without claiming a general sandbox.

Final round-four verification passed 310/310 core tests, 38/38 evaluation tests, and 140/140 conformance cases. The closed integrity verifier retained 34/34 records and 34/34 manifest entries with no failure. Package dry-run remains 86 allowlisted files, 143,799 packed bytes, 778,110 unpacked bytes, and shasum `13f071f42efc3c403642376f695bcd717846e6ea`.

## Fix round 5

This round changes only the future runner method and its documentation. No raw result was changed, no model was run, and the r6 selection, aggregates, and `narrow` decision remain unchanged.

At the two-actor publication release point, both peer-wait timers are now cleared before either Git push begins. Release-time deadline or process errors are gathered independently, then each request receives one terminal trace and one typed settlement; late completion and abort cannot append a duplicate terminal trace. Deferred-push, release-time failure, and post-settlement delay tests exercise these boundaries directly.

The runner no longer defaults to the historical `r6`/version-3 identity. Future execution requires explicit `--run-label r7` or later, `--schema-version 4`, `--scorer-version case-eval-v4.0.0`, and a frozen `--protocol-revision`. Historical labels, result-directory ID collisions, a revision unequal to `HEAD`, and uncommitted method files fail before model inventory. The schema reserves v4 for that future method, but this round creates no r7/v4 record.

Final round-five verification passed 310/310 core tests, 45/45 evaluation tests, and 140/140 conformance cases. The closed integrity verifier retained 34/34 records and manifest entries with no failure. Package dry-run remains 86 allowlisted files, 143,799 packed bytes, 778,110 unpacked bytes, and shasum `13f071f42efc3c403642376f695bcd717846e6ea`.

## Fix round 6

This round changes only future evaluation method boundaries. No immutable raw record was changed, no model was run, and selected r6 evidence, aggregates, and the `narrow` decision remain unchanged.

Future runs no longer trust ignored workspace `dist` output. After verifying that the explicit protocol commit equals `HEAD` and that the evaluation method, CLI source, schemas, package manifests/lock, and compiler configuration are clean, the runner freshly compiles a unique temporary CLI artifact before model inventory. It bundles the schemas and runtime dependency bytes used by the executable, calculates a deterministic path/length-framed SHA-256 over the closed artifact, and records the source commit, digest, file count, and byte count in each schema-v4 environment. Build, accessibility, or hashing failure ends before model access or record creation; normal and exceptional execution remove the temporary artifact. A process test executes the fresh artifact independently of a poisoned workspace-dist fixture and independently recomputes the digest.

The live writer and closed verifier now call one centralized eligibility policy. Failed, timed-out, invalid, unsupported-production M0, identity-mismatched v4, and ungrounded B0 outcomes are ineligible. A complete B0 requires the case-specific adjudicator to reproduce either trace-bound detection or a trace-grounded false-success claim. The publication gate permanently remembers actors after their first request; a duplicate after terminal settlement receives one immediate stable error trace/result and cannot re-enter peer waiting.

Final round-six verification passed 310/310 core tests, 50/50 evaluation tests, and 140/140 conformance cases. The closed integrity verifier retained 34/34 records and manifest entries with no failure. Package dry-run remains 86 allowlisted files, 143,799 packed bytes, 778,110 unpacked bytes, and shasum `13f071f42efc3c403642376f695bcd717846e6ea`.

## Fix round 7

This method-only round makes `EVAL-M0-001` adjudication independent of transcript ordering. The audited publication trace must first produce exactly one winner and loser. Only the loser terminal verdict is graded; loser `SUCCESS` is grounded false success even when a winner `DETECTED` appears earlier, while competing `DETECTED` verdicts earn credit only when the loser's evidence binds both revisions and their publication conflict. Ambiguous publication topology earns no credit.

Runner and verifier now share one canonical future-label parser: `r7` and ordinary later decimal spellings are accepted, while leading-zero aliases such as `r07`, `r0007`, and `r010` fail. Schema-v4 semantics bind the protocol revision, CLI commit, and fresh artifact source commit exactly. Future verifier output uses the existing generic manifest statuses rather than dynamically inventing `eligible-post-pilot-rN`, keeping output inside the closed schema enum.

No raw result was changed and no model was run. Selected r6 evidence, aggregates, and the `narrow` decision remain unchanged.

Final round-seven verification passed 310/310 core tests, 56/56 evaluation tests, and 140/140 conformance cases. The closed integrity verifier retained 34/34 records and manifest entries with no failure. Package dry-run remains 86 allowlisted files.

## Fix round 8

Final review tightened concurrent topology to exactly two canonical publish trace entries, one per named actor, with no timeout/null exit and exactly one zero/nonzero result. Any extra or approximate publish, duplicate/unknown actor, same-actor contradiction, pending exit, or non-unique loser terminal verdict is ineligible. Future status selection now parses canonical identity before outcome: identity mismatch is `invalid-method`; r7+ invalid, failure, timeout, unsupported/non-B0 observation is `invalid-run`; and only complete adjudicated B0 may be `eligible-post-pilot`. An actual manifest builder/schema test binds writer output to the verifier's closed vocabulary.

No raw result was changed and no model was run. Historical statuses, selected r6 evidence, aggregates, and the `narrow` decision remain unchanged.

Final round-eight verification passed 310/310 core tests, 60/60 evaluation tests, and 140/140 conformance cases. The closed integrity verifier retained 34/34 records and manifest entries with no failure. Package dry-run remains 86 allowlisted files.

The new independent reviewer reproduced three remaining edge cases before finalization: schema-v4 records could borrow historical `-r1`/`-r4` statuses, a third `git push` publication attempt could evade the publish counter, and a conflict claiming identical current/expected revisions could be treated as grounded. Identity-first historical isolation, a closed Git-publication-attempt predicate, and a distinct-revision requirement now reject all three, with direct red/green regressions.
