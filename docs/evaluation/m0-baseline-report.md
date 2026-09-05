---
title: M0 Markdown baseline and preview evidence boundary
status: recorded-with-invalid-m0-production-arm
evaluated_at: 2026-09-05
---

# M0 baseline report

## Decision

**Narrow. Stop feature and packaging expansion until one real production filesystem adapter passes the frozen corpus, then rerun the preregistered comparison.**

M0 does not satisfy its advance gate on this host. The public Windows CLI correctly fails closed, but that makes all four production M0 runs invalid before their target failure can be exercised. Controlled-test corpus success is not substituted for production evidence. The usable Markdown baseline detects three of four failures and produces false success in the same-version double-writer case.

This report does not support claims that C.A.S.E. is reliable, cross-platform, weak-model ready, enterprise ready, or better than Markdown plus Git.

## Frozen question and provenance

- Frozen comparison protocol and four cases: commit `c7e1e083065e62956055286c03b4bd8564e729d2`.
- Public CLI/help used by r1/r2: `ca6ea1dcb54b665568b40fb04e63b7a8ab57e13a`.
- Post-pilot runner recorded after r2: `6f8228ca2c01688e9c484ea50f63cd0c90f59259`.
- Concurrent-writer runner amendment was not committed before r3 execution and is therefore labeled post-pilot, not preregistered; its source was recorded afterward in `ea43b39bb89bdf995037b73bb9ffa2f78cc0d032`.
- Result records: `evaluation/markdown-baseline/results/`; all invalid, failed, and complete attempts remain present.

## Runtime

- OS/runtime: Windows x64, Node.js `v24.19.0` (`Microsoft Windows NT 10.0.26200.0`).
- Model endpoint: llama.cpp at `127.0.0.1:8080`, started twice from the user-authorized unmodified launcher and stopped after each evaluation window.
- Model: `C:\models\Qwen3.8\orcarouter-F16\Qwen3.8-27B-Uncensored-orcarouter-STRIX_LEAN.gguf`.
- Server executable: `D:\MyProject\ROCmFPX\build-win-hip-ninja\bin\llama-server.exe`.
- Server configuration: context `262144`, parallel `1`, flash attention on, batch `2048`, ubatch `1024`, draft-MTP strict Qwen, `n=3`, `p-min=0.60`, froggeric v22.4 chat template, reasoning format `deepseek` with preservation.
- r1 API sampling: temperature `0`, max tokens `700`, one completion, seed unavailable.
- r2/r3 API sampling: temperature `0`, max tokens `1800`, `reasoning_effort=low`, one completion, seed unavailable.
- Timeout/stop rule: 20 actor turns, 30 commands, or 10 minutes; no run reached these limits.

The same local model/server was designated for both arms. M0 made no model request because the public CLI became unavailable at initialization; its token fields are therefore null rather than invented zero-use measurements.

## Execution history

### r1 — preregistered pilot, retained but invalid

Eight records are retained. The driver did not fix Git author/committer timestamps, so paired B0/M0 fixture commit hashes differed. B0 also exhausted the 700-token completion budget before the required verdict in all four cases. Every r1 record is `invalid`; none receives detection credit.

This pilot caused two explicit amendments: deterministic Git timestamps and a larger, recorded completion budget with low reasoning effort. The amendments were made before r2 but not committed before it, so r2 is labeled post-pilot rather than preregistered.

### r2/r3 — post-pilot amended observations

The selected usable B0 records are r3 for EVAL-M0-001 and r2 for EVAL-M0-002 through 004. Each selected M0 record has the exact same fixture revision as its paired B0 record.

| Case | B0 outcome | B0 detected | B0 false success | B0 burden | M0 outcome | M0 observation |
|---|---|---:|---:|---|---|---|
| EVAL-M0-001 same-version double writer | complete | no | yes | 2 commands; 107,535 ms; 1,081 in / 2,889 out tokens | invalid | init exit 10, `CASE_E_UNSUPPORTED_PROFILE` |
| EVAL-M0-002 stale handoff | complete | yes | no | 4 commands; 18,945 ms; 608 in / 524 out tokens | invalid | init exit 10, `CASE_E_UNSUPPORTED_PROFILE` |
| EVAL-M0-003 accepted artifact changed | complete | yes | no | 5 commands; 27,464 ms; 706 in / 791 out tokens | invalid | init exit 10, `CASE_E_UNSUPPORTED_PROFILE` |
| EVAL-M0-004 evidence digest mismatch | complete | yes | no | 5 commands; 26,385 ms; 708 in / 731 out tokens | invalid | init exit 10, `CASE_E_UNSUPPORTED_PROFILE` |

Selected B0 aggregate: 3/4 detected; 1/4 false success; 16 commands; 180,329 ms; 3,103 input tokens; 4,935 output tokens; 0 user decisions; 0 corrections; 0 recovery steps.

Selected M0 aggregate: 0/4 target failures exercised; four invalid outcomes; four initialization commands; 2,325 ms; token counts unavailable; 0 user decisions; 0 corrections; 0 recovery steps. These timing/command figures measure early rejection only and are not comparable M0 task burden.

r2 EVAL-M0-001 is also retained as invalid: it used one post-hoc evaluator instead of two writer actors. r3 corrected the actor topology. In r3, both isolated actors began from `a4fbf1245e52890b82e7723f630153d831dcbe33`, committed independently, saw only their own success, and both reported `SUCCESS`. The phrase “DETECTED — not applicable” in actor B's answer is explicitly not graded as detection.

## Interpretation

The B0 observations support only a small conclusion: explicit recorded versions/digests made three stale-artifact or stale-handoff situations discoverable to this model, while independent Markdown/Git writers could both believe their same-basis work was current. This is one post-pilot sample per case, not a model-general result.

The deterministic controlled-test corpus now passes 140 cases and includes the complete semantic double-writer, stale-handoff, stale-acceptance, and changed-evidence behaviors. That is implementation/conformance evidence under injected capabilities. It cannot answer whether a public production M0 adapter works on Windows or POSIX.

## Offline help and package boundary

`case-agent --help` is a real bundled process surface executed before platform initialization. Its conformance binding closes `M0-OFFLINE-008` by checking actual public output and read-only behavior. Help and README state the exact command surface, local data footprint, identity/recovery limits, and unsupported profiles.

The package dry run reported 86 entries, 143,772 packed bytes, and 777,996 unpacked bytes. The complete allowlisted file set is:

- `README.md` and `package.json`;
- nine schemas: `checks`, `decision`, `definitions`, `dossier`, `handoff`, `manifest`, `observed-evidence`, `result`, and `submission` (`schemas/*.schema.json`);
- each of `.d.ts`, `.js`, and `.js.map` for CLI modules `args`, `confirm`, `help`, `main`, and `render`;
- each of `.d.ts`, `.js`, and `.js.map` for conformance module `runner`;
- each of `.d.ts`, `.js`, and `.js.map` for protocol modules `canonical`, `checks`, `errors`, `json`, `projections`, `result`, `schema-registry`, `transitions`, and `types`;
- each of `.d.ts`, `.js`, and `.js.map` for storage modules `atomic`, `guard`, `paths`, and `store`;
- each of `.d.ts`, `.js`, and `.js.map` for workflow modules `decision`, `dossier`, `evidence`, `handoff`, `init`, and `submission`.

No tests, evaluation records, caches, secrets, local dossiers, conformance fixtures, or generated tarball appear in the dry-run list. Dry-run shasum: `20a8dd6763672671ff8f8b2fabe34e8472ea9e88`.

## Verification and remaining gates

- Clean dependency install succeeded with 9 packages using the Node 24 bundled npm `11.17.0` CLI. The normal `npm.cmd` first failed because the user's separate roaming npm installation is missing `npm-bundled`; no global installation was changed.
- Typecheck: zero errors.
- Conformance: 140 total, 140 passed, 0 failed, no uncovered positive or negative direction.
- The first full test run after adding the 140th case exposed one stale hard-coded expected corpus count (`139`). It produced 310 tests, 308 passed, 2 failure entries (the leaf assertion and its parent suite). After correcting the count to 140, a fresh exact `npm run check` passed typecheck, all 310 tests, and all 140 conformance cases with zero skipped/todo and no uncovered direction.
- Package dry-run: 86 allowlisted files; prohibited categories absent.

Remaining release blockers:

1. no proven production filesystem adapter/profile;
2. no valid production M0 baseline run;
3. post-pilot protocol amendments need a newly frozen rerun after a real adapter exists;
4. independent final review must still reconcile spec, schema, CLI, fixtures, package, and claims;
5. deferred earlier-task findings remain for final-branch triage.
