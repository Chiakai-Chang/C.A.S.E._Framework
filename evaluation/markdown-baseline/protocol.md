# B0/M0 preregistered comparison protocol

Status: frozen before execution

Frozen against CLI commit: `55c8c47cb7639c4106af6016f41ce8c4c3c6afc7`

## Question and decision rule

This comparison asks only whether M0 detects four predefined stale/conflicting-work failures without false success, and what extra burden it imposes relative to Markdown plus Git. It does not test general agent quality.

M0 may advance beyond this milestone only when every M0 record is valid, all four failures are detected, no M0 run reports false success, and the added commands, decisions, corrections, elapsed time, and available token counts are documented and judged acceptable. Otherwise the decision is `narrow` or `stop`; implementation effort is not evidence.

## Arms

- **B0 — Markdown + Git:** one `CASE.md` file records objective, actors, handoff/submission/decision prose, evidence path, and the last Git commit observed by the actor. The actor may use only the commands listed in the case. No C.A.S.E. protocol state or CLI is available.
- **M0 — protocol + public CLI:** the same repository content and actor prompt are used, with `.case-agent/` created only through the packaged public CLI. No skill, controlled-test port, direct governed-file edit, or hidden environment switch is available. Git is used only for the case's declared repository-content mutation.

The public Windows M0 profile is preregistered as unsupported. If the CLI returns `CASE_E_UNSUPPORTED_PROFILE`, that run is recorded as `invalid`, not as detection and not as a successful baseline result.

## Actor and model

Use the same local OpenAI-compatible llama.cpp endpoint and model for both arms when it can be started without modifying the installation:

- launcher: `C:\models\Qwen3.8-27B-Orcarouter_ROCmFP4_STRIX_LEAN.bat`
- endpoint: `http://127.0.0.1:8080/v1/chat/completions`
- executable configured by launcher: `D:\MyProject\ROCmFPX\build-win-hip-ninja\bin\llama-server.exe`
- model configured by launcher: `C:\models\Qwen3.8\orcarouter-F16\Qwen3.8-27B-Uncensored-orcarouter-STRIX_LEAN.gguf`
- configured context: `262144`
- configured parallel slots: `1`
- configured speculative/MTP setting: strict `n=3`

Record the endpoint's reported model identity and usage tokens. If the endpoint cannot become ready or does not return stable usage metadata, preserve the run as `invalid` with the exact reason; never substitute another model for one arm.

The actor receives only the frozen case prompt, current repository observations, prior command results from the same run, and the arm contract above. The evaluator executes a requested allowed command and returns stdout, stderr, and exit status. A command outside the allowlist ends the run as `failed`. The evaluator does not repair the actor's command.

## Common start and isolation

Each `(arm, case)` uses a new local Git repository copied from the same case fixture and initialized at the same fixture commit. No run may reuse another run's working tree or chat context. Runtime, OS, model, sampling configuration, case revision, CLI commit, start/end timestamps, and result-file digest are recorded.

The model sampling request is deterministic where the server permits it: temperature `0`, one completion, and a fixed prompt. The random seed is recorded as unavailable if the endpoint does not expose one.

## Stop rules

Each run stops at the first of:

1. the actor explicitly reports `DETECTED` with the conflicting/stale fact and cites the observation that proves it;
2. the actor explicitly reports `SUCCESS` or completion while the injected failure remains undetected (`false_success: true`);
3. an allowed-command violation, unrecoverable command error, or model/runner failure (`failed`);
4. the arm is unavailable before the case can exercise its target, including an unsupported platform (`invalid`);
5. 20 actor turns, 30 commands, or 10 minutes elapsed (`timeout`).

Partial, failed, timed-out, and invalid records are retained. No rerun replaces a prior record; it receives a new record ID.

## Measurements and grading

Primary fields are `detected`, `false_success`, and `outcome`. Detection requires an explicit actor conclusion grounded in the version/digest/state observation relevant to the frozen case; a generic warning is insufficient.

Secondary burden fields are user decisions, executed commands, elapsed milliseconds, input/output tokens when reported, corrections, and recovery steps. A user decision is a choice requested from a human beyond the initial task. A correction is evaluator intervention needed to repair an actor mistake; merely returning a command result is not a correction.

Every record validates against `results.schema.json`. Commands are counted, while an ordered trace in the record preserves exact command text and result classification. Secrets, model weights, full prompts containing repository-sensitive data, and local dossier contents are not committed.

## Frozen cases

The following files are normative for this comparison:

- `cases/same-version-double-writer.md`
- `cases/stale-handoff-after-intervening-work.md`
- `cases/accepted-artifact-changed.md`
- `cases/evidence-digest-mismatch.md`

