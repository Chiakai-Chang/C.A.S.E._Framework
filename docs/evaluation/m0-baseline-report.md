---
title: M0 Markdown baseline and preview evidence boundary
status: recorded-with-invalid-m0-production-arm
evaluated_at: 2026-09-05
---

# M0 baseline report

## Decision

**Narrow. Stop feature and packaging expansion until one real production filesystem adapter passes the frozen corpus, then rerun the preregistered comparison.**

M0 does not satisfy its advance gate on this host. The public Windows CLI correctly fails closed, but that makes all four production M0 runs invalid before their target failure can be exercised. Controlled-test corpus success is not substituted for production evidence. Independent review invalidated r3's writer method and r4's provenance/process boundary. The later method-frozen r6 B0 replacement detected all four injected failures without false success, but its four paired M0 runs remain invalid, so no valid comparative result or advance claim exists.

This report does not support claims that C.A.S.E. is reliable, cross-platform, weak-model ready, enterprise ready, or better than Markdown plus Git.

## Frozen question and provenance

- Frozen comparison protocol and four cases: commit `c7e1e083065e62956055286c03b4bd8564e729d2`.
- Public CLI/help used by r1/r2: `ca6ea1dcb54b665568b40fb04e63b7a8ab57e13a`.
- Post-pilot runner recorded after r2: `6f8228ca2c01688e9c484ea50f63cd0c90f59259`.
- Concurrent-writer runner amendment was not committed before r3 execution and is therefore labeled post-pilot, not preregistered; its source was recorded afterward in `ea43b39bb89bdf995037b73bb9ffa2f78cc0d032`.
- r5 method and process/integrity tests were frozen at `d39dce25393d83fdf1829b344920274d0ff86e83`; its first retained-output attempt failed at the repository storage boundary and is reconstructed in `evaluation/markdown-baseline/attempts/2026-09-05-r5-d39dce2.md`.
- The r6 storage amendment was frozen at `09a96bc84c013b5e4d586aa4270a922f6a6e9fea`; eight immutable r6 records were introduced by `15778ffc77c9c1fe834fab810f5f71021dfc2c9c`.
- Result records: `evaluation/markdown-baseline/results/`; all invalid, failed, and complete attempts remain present.

## Runtime

- OS/runtime: Windows x64, Node.js `v24.19.0` (`Microsoft Windows NT 10.0.26200.0`).
- Model endpoint: llama.cpp at `127.0.0.1:8080`, started from the user-authorized unmodified launcher and stopped after each evaluation window, including the failed r5 attempt and r6 replacement.
- Model: `C:\models\Qwen3.8\orcarouter-F16\Qwen3.8-27B-Uncensored-orcarouter-STRIX_LEAN.gguf`.
- Server executable: `D:\MyProject\ROCmFPX\build-win-hip-ninja\bin\llama-server.exe`.
- Server configuration: context `262144`, parallel `1`, flash attention on, batch `2048`, ubatch `1024`, draft-MTP strict Qwen, `n=3`, `p-min=0.60`, froggeric v22.4 chat template, reasoning format `deepseek` with preservation.
- r1 API sampling: temperature `0`, max tokens `700`, one completion, seed unavailable.
- r2/r3 API sampling: temperature `0`, max tokens `1800`, `reasoning_effort=low`, one completion, seed unavailable.
- Timeout/stop rule: 20 actor turns, 30 commands, or 10 minutes; no run reached these limits.
- r6 stable provenance: model basename `Qwen3.8-27B-Uncensored-orcarouter-STRIX_LEAN.gguf`, SHA-256 `2362c12d0783b0e92e49e129c7bb2c47898ffc6c116935974582827d93fb482b`, 14,845,105,536 bytes; server basename `llama-server.exe`, SHA-256 `b7b0f8d5a0c43f2e69dc6c78a90449b6fb7f0e1f1a57882573a67a1c45dea59e`, 9,216 bytes. Directories were redacted only after hashing.

The same local model/server was designated for both arms. M0 made no model request because the public CLI became unavailable at initialization; its token fields are therefore null rather than invented zero-use measurements.

## Execution history

### r1 — preregistered pilot, retained but invalid

Eight records are retained. The driver did not fix Git author/committer timestamps, so paired B0/M0 fixture commit hashes differed. B0 also exhausted the 700-token completion budget before the required verdict in all four cases. Every r1 record is `invalid`; none receives detection credit.

This pilot caused two explicit amendments: deterministic Git timestamps and a larger, recorded completion budget with low reasoning effort. The amendments were made before r2 but not committed before it, so r2 is labeled post-pilot rather than preregistered.

### r2/r3 — post-pilot amended observations, with r3 invalidated

The r2 B0 records for EVAL-M0-002 through 004 remain post-pilot observations. r2 EVAL-M0-001 is invalid because it used one post-hoc evaluator. r3 EVAL-M0-001 is also invalid: the evaluator created two disconnected commits before asking the model actors to judge a claimed success, no shared publication authority existed, and the committed record omitted the exact raw actor outputs needed to reproduce its manual grading. The immutable r3 record is retained unchanged; its invalid eligibility is recorded externally rather than rewriting old raw data.

| Case | B0 outcome | B0 detected | B0 false success | B0 burden | M0 outcome | M0 observation |
|---|---|---:|---:|---|---|---|
| EVAL-M0-001 same-version double writer | invalid method | not graded | not graded | historical record retained; excluded from aggregation | invalid | init exit 10, `CASE_E_UNSUPPORTED_PROFILE` |
| EVAL-M0-002 stale handoff | complete | yes | no | 4 commands; 18,945 ms; 608 in / 524 out tokens | invalid | init exit 10, `CASE_E_UNSUPPORTED_PROFILE` |
| EVAL-M0-003 accepted artifact changed | complete | yes | no | 5 commands; 27,464 ms; 706 in / 791 out tokens | invalid | init exit 10, `CASE_E_UNSUPPORTED_PROFILE` |
| EVAL-M0-004 evidence digest mismatch | complete | yes | no | 5 commands; 26,385 ms; 708 in / 731 out tokens | invalid | init exit 10, `CASE_E_UNSUPPORTED_PROFILE` |

The earlier 3/4 detection and 1/4 false-success figures are withdrawn because they depended on invalid r3 evidence.

Selected M0 aggregate: 0/4 target failures exercised; four invalid outcomes; four initialization commands; 2,325 ms; token counts unavailable; 0 user decisions; 0 corrections; 0 recovery steps. These timing/command figures measure early rejection only and are not comparable M0 task burden.

r3 did not correct the actor topology: blocking evaluator commits in disconnected clones are not concurrent model-directed writes against one shared authority. Its reason field contains only a manual summary, not the exact response needed to reproduce the override of the phrase “DETECTED — not applicable.” r4 therefore uses two independent command-loop actors and an asynchronous shared Git compare-and-swap publication gate, and version 2 records retain exact privacy-safe outputs plus explicit versioned adjudication.

### r4 — method-frozen post-pilot observations

The r4 method was committed as `3b8be9dcaa96ca43d5ff99efbba5e23dbdf3b67d` before execution. All eight immutable version 2 records were then committed separately. In EVAL-M0-001, both model actors received basis `a4fbf1245e52890b82e7723f630153d831dcbe33` before editing, selected their own read/edit/add/commit commands, and waited at one shared publication gate. Two asynchronous pushes raced the same `published` ref: actor B won, actor A received Git's compare-and-swap rejection, actor A reported `DETECTED`, and actor B fetched and verified the published result before reporting `SUCCESS`.

| Case | r4 B0 outcome | B0 detected | B0 false success | B0 burden | paired r4 M0 |
|---|---|---:|---:|---|---|
| EVAL-M0-001 same-version double writer | complete | yes | no | 19 commands; 82,346 ms; 21,691 in / 1,568 out tokens | invalid: init exit 10 |
| EVAL-M0-002 stale handoff | complete | yes | no | 4 commands; 33,466 ms; 597 in / 876 out tokens | invalid: init exit 10 |
| EVAL-M0-003 accepted artifact changed | complete | yes | no | 5 commands; 32,030 ms; 695 in / 829 out tokens | invalid: init exit 10 |
| EVAL-M0-004 evidence digest mismatch | complete | yes | no | 5 commands; 27,979 ms; 697 in / 695 out tokens | invalid: init exit 10 |

r4 B0's raw outcomes remain 4/4 detected and 0/4 false success, but they are withdrawn from selected evidence. The records used `<local-path>` instead of a verifiable model artifact, and the runner had not proven the final owned-process-tree timeout boundary. The external manifest therefore labels every r4 record `invalid-provenance-runner-boundary`; the immutable raw bytes were not rewritten.

### r5 incident and r6 method-frozen replacement

The first r5 invocation failed Git's ownership preflight before any model request. A process-local exact `safe.directory` allowed the next invocation to proceed without changing global Git configuration. That invocation executed EVAL-M0-001 but the D: repository filesystem rejected Node's hard-link result publication with `EISDIR`; the stable terminal failure was emitted, no record/temp remained, later cases were stopped, and the model output receives no credit. The incident was committed before the r6 storage amendment.

r6 preserves the r5 actor method while using new IDs and a tested Windows atomic publication boundary. EVAL-M0-001 used two model conversations, identical pre-write basis, model-selected read/edit/add/commit/publish/observe commands, and concurrent compare-and-swap pushes to one shared ref. EVAL-M0-002 through 004 required a model-selected basis observation, explicit `ready`, frozen injection, a further model-selected observation, and then the model verdict.

| Case | r6 B0 outcome | B0 detected | B0 false success | B0 burden | paired r6 M0 |
|---|---|---:|---:|---|---|
| EVAL-M0-001 same-version double writer | complete | yes | no | 19 commands; 78,859 ms; 20,842 in / 1,683 out tokens | invalid: init exit 10 |
| EVAL-M0-002 stale handoff | complete | yes | no | 8 commands; 87,045 ms; 7,499 in / 2,276 out tokens | invalid: init exit 10 |
| EVAL-M0-003 accepted artifact changed | complete | yes | no | 4 commands; 38,552 ms; 3,285 in / 1,042 out tokens | invalid: init exit 10 |
| EVAL-M0-004 evidence digest mismatch | complete | yes | no | 4 commands; 31,237 ms; 3,299 in / 850 out tokens | invalid: init exit 10 |

r6 B0 aggregate: 4/4 detected; 0/4 false success; 35 trace events, comprising 32 actor commands and 3 evaluator injection events; 235,693 ms; 34,925 input tokens; 5,851 output tokens; zero user decisions, corrections, or recovery steps. A command is a model-selected allowed operation; an evaluator event is the frozen external injection and is not actor burden. Paired r6 M0 aggregate: four invalid outcomes, four runner init commands, 2,276 ms, unavailable token counts, and no target failure exercised.

## Interpretation

The immutable r6 B0 records were re-adjudicated post hoc by a case-specific deterministic scorer. It requires trace-backed old/current revisions or digests, the artifact/ref relation, the frozen injection or publication conflict, and matching actor evidence; generic or unrelated `DETECTED` text earns no credit. All four r6 B0 records reproduce their original detection classification. This supports only a narrow provisional conclusion for this exact model artifact and method. The sample is one post-pilot run per case and is not model-general evidence. Because all paired production M0 runs are invalid, it cannot establish that M0 outperforms Markdown plus Git.

The deterministic controlled-test corpus now passes 140 cases and includes the complete semantic double-writer, stale-handoff, stale-acceptance, and changed-evidence behaviors. That is implementation/conformance evidence under injected capabilities. It cannot answer whether a public production M0 adapter works on Windows or POSIX.

## Offline help and package boundary

`case-agent --help` is a real bundled process surface executed before platform initialization. Its conformance binding closes `M0-OFFLINE-008` by checking actual public output and read-only behavior. Help and README state the exact command surface, local data footprint, identity/recovery limits, and unsupported profiles.

The final package dry run reported 86 entries, 143,799 packed bytes, and 778,110 unpacked bytes. The complete allowlisted file set is:

- `README.md` and `package.json`;
- nine schemas: `checks`, `decision`, `definitions`, `dossier`, `handoff`, `manifest`, `observed-evidence`, `result`, and `submission` (`schemas/*.schema.json`);
- each of `.d.ts`, `.js`, and `.js.map` for CLI modules `args`, `confirm`, `help`, `main`, and `render`;
- each of `.d.ts`, `.js`, and `.js.map` for conformance module `runner`;
- each of `.d.ts`, `.js`, and `.js.map` for protocol modules `canonical`, `checks`, `errors`, `json`, `projections`, `result`, `schema-registry`, `transitions`, and `types`;
- each of `.d.ts`, `.js`, and `.js.map` for storage modules `atomic`, `guard`, `paths`, and `store`;
- each of `.d.ts`, `.js`, and `.js.map` for workflow modules `decision`, `dossier`, `evidence`, `handoff`, `init`, and `submission`.

No tests, evaluation records, caches, secrets, local dossiers, conformance fixtures, or generated tarball appear in the dry-run list. Final dry-run shasum: `13f071f42efc3c403642376f695bcd717846e6ea`.

## Verification and remaining gates

- Clean dependency install succeeded with 9 packages using the Node 24 bundled npm `11.17.0` CLI. The normal `npm.cmd` first failed because the user's separate roaming npm installation is missing `npm-bundled`; no global installation was changed.
- Typecheck: zero errors.
- Conformance: 140 total, 140 passed, 0 failed, no uncovered positive or negative direction.
- The first full test run after adding the 140th case exposed one stale hard-coded expected corpus count (`139`). It produced 310 tests, 308 passed, 2 failure entries (the leaf assertion and its parent suite). After correcting the count to 140, a fresh exact `npm run check` passed typecheck, all 310 tests, and all 140 conformance cases with zero skipped/todo and no uncovered direction.
- Package dry-run: 86 allowlisted files; prohibited categories absent.
- Evaluation validation after r6: 34/34 immutable records pass the closed schema and semantic validator; the external integrity manifest has the exact recursive 34/34 result set with unique paths and no SHA-256/Git-blob/first-containing-commit/status/protocol mismatch.
- Round-two method tests include abort deadlines, partial timeout traces, normal-descendant termination, spawn-rejection peer cleanup, persistence failure continuation, D: filesystem atomic publication, stale reservation failure, recursive closed-manifest set equality, relabel/drop/duplicate detection, and single-buffer mutation resistance. This is not an arbitrary process-tree or sandbox claim.
- Final exact `npm run check` after r6: typecheck passed; 310/310 core tests and 27/27 evaluation tests passed with no failed/skipped/todo; conformance passed 140/140 with no uncovered direction. Post-result round-four runner hardening passes the same 310/310 core and 140/140 conformance gates plus 38/38 evaluation tests; it changes no raw result and ran no model.
- Final fix-round-three `npm run check`: typecheck passed; 310/310 core tests and 32/32 evaluation tests passed with no failed/skipped/todo; conformance passed 140/140 with no uncovered direction.
- Final range `git diff --check 55c8c47..HEAD`: clean.

Post-result runner method note: the publication gate now clears both wait timers at release and settles each request exactly once after bounded push outcomes are gathered. Future runs have no r6/v3 default and must explicitly use a unique r7-or-later label, reserved schema v4, v4 scorer, and a clean frozen method revision. No r7/v4 evaluation was executed; all selected r6 arithmetic and the `narrow` decision above are unchanged.

Round-five verification: 310/310 core tests, 45/45 evaluation tests, and 140/140 conformance cases passed; 34/34 immutable records and manifest entries verified with no failure; package contents and hash remained unchanged.

Remaining release blockers:

1. no proven production filesystem adapter/profile;
2. no valid production M0 baseline run;
3. post-pilot protocol amendments need a newly frozen rerun after a real adapter exists;
4. independent final review must still reconcile spec, schema, CLI, fixtures, package, and claims;
5. deferred earlier-task findings remain for final-branch triage.
