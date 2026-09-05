# Task 12 report — baseline evidence and preview boundary

## Outcome

Task 12 records the frozen four-case protocol, 26 immutable attempt records across r1-r4, bounded preview help/README, package boundary, and alignment decision. The decision is `narrow`: no feature expansion until a real production adapter passes the corpus and enables a valid M0 rerun.

## Commits before results

- `c7e1e083065e62956055286c03b4bd8564e729d2` — frozen protocol/cases/schema plus Task 11 provenance.
- `ca6ea1dcb54b665568b40fb04e63b7a8ab57e13a` — public offline help and executable conformance binding.
- `6f8228ca2c01688e9c484ea50f63cd0c90f59259` — r2 runner recorded after execution; explicitly post-pilot.
- `ea43b39bb89bdf995037b73bb9ffa2f78cc0d032` — concurrent-writer runner recorded after r3 execution; explicitly post-pilot.
- `3b8be9dcaa96ca43d5ff99efbba5e23dbdf3b67d` — r4 method, runner, schema, semantic validator, and cases frozen before execution.
- `bdafa3f4456578cd0bf5a64fdf1f111088586491` — eight immutable r4 outcomes committed after execution.

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
- method-frozen r4 B0: 4/4 detected, 0/4 false success; 33 commands; 175,821 ms; 23,680 input and 3,968 output tokens; exact privacy-safe actor outputs and versioned adjudication retained.
- paired r4 M0: four invalid production Windows outcomes at init; 4 commands; 2,827 ms; tokens unavailable; no controlled-test substitution.
- user decisions, corrections, and recovery steps: zero in selected observations.

The authorized server was started three times from the unmodified batch. After each evaluation window, the listener owner was verified as the exact configured `llama-server.exe` and that single process was stopped (PIDs 44788, 33496, and 43920). Pi and model files were not changed.

## Exact verification commands and results

- `npm.cmd --cache .npm-cache ci` — failed before install because the user's roaming npm copy lacks `npm-bundled`.
- `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" --cache .npm-cache ci` — success, 9 packages.
- direct bundled npm `run typecheck` — success, zero errors.
- first direct bundled npm `test` — 310 tests, 308 passed, 2 failure entries caused by one stale expected total (139 versus 140); this was the expected red evidence for the count correction.
- fresh direct bundled npm `run check` after the fix — typecheck passed; 310 tests passed with zero failures, skipped, or todo; conformance passed 140/140 with no uncovered direction.
- direct bundled npm `run conformance` after the fix — 140 total, 140 passed, 0 failed, no uncovered direction.
- AJV 2020 plus semantic validation of every committed result — 26 total, 26 valid, 0 invalid; external integrity manifest 26/26 with no digest/blob/commit mismatch.
- direct bundled npm `pack --dry-run --json` — 86 entries; 143,772 packed bytes; 777,996 unpacked bytes; shasum `20a8dd6763672671ff8f8b2fabe34e8472ea9e88`; prohibited categories absent.

## Package file list

The exact compressed list is README and package metadata; nine named schemas; and the `.d.ts`, `.js`, `.js.map` triplet for 5 CLI, 1 conformance, 9 protocol, 4 storage, and 6 workflow modules. The expanded module names and package statistics are recorded in the baseline report.

## Remaining limitations

- Windows production mutation unsupported; POSIX unclaimed.
- M0 production baseline invalid and therefore cannot satisfy the advance gate.
- r2/r3 are post-pilot amendments, not preregistered samples.
- r3 is retained but method-invalid and cannot be selected as comparative evidence; r4 replaces only the post-pilot observation, not the old record.
- r4 is post-pilot evidence rather than a preregistered comparison; M0 remains wholly invalid, so the decision remains `narrow`.
- Controlled-test conformance is not production support.
- Independent whole-branch review remains a controller gate; Task 12's full check, package dry-run, result-schema validation, and diff/status accounting are complete.
