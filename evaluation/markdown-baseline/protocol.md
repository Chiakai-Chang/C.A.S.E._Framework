# B0/M0 preregistered comparison protocol

Status: original r1 preregistration retained; post-pilot r6 storage-boundary amendment to be frozen after a failed r5 persistence attempt and before replacement outcomes

Original protocol frozen against CLI commit: `55c8c47cb7639c4106af6016f41ce8c4c3c6afc7`. The r5 protocol revision is the later method commit containing this amendment; the runner requires that exact commit as an execution argument and writes it into every r5 record. r4 remains immutable but is ineligible: its path placeholders cannot prove the model artifact and its runner did not meet the final process-tree/timeout boundary.

The first execution against method commit `d39dce25393d83fdf1829b344920274d0ff86e83` reached the first record persistence boundary, where this repository filesystem rejected the tested hard-link publication primitive with `EISDIR`. The runner emitted a stable terminal persistence failure, left no record or temporary file, and the remaining cases were stopped. This disclosed failure is not an outcome sample. The later r6 method commit uses a same-directory fsynced temporary file and a per-record exclusive reservation before Windows atomic rename; POSIX uses an atomic hard link followed by temporary cleanup. A pre-existing target is never overwritten. An abandoned Windows reservation with no target fails closed as an explicit stale-reservation recovery condition; it is not silently stolen. `finally` removes only the current run's unique temporary and owned reservation. Replacement outcomes use new r6 record IDs and cite the later commit.

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

For r5, read the endpoint's raw model path only in memory, hash and size that exact artifact before redaction, and persist only its basename, SHA-256, and byte size. Likewise persist the server executable basename, SHA-256, byte size, and stable configuration ID. Record usage tokens. If provenance or the endpoint is unavailable, retain a non-complete record with `provenance_status: unavailable`; never substitute another model for one arm.

The actor receives only the frozen case prompt, current repository observations, prior command results from the same run, and the arm contract above. The evaluator executes a requested allowed command and returns stdout, stderr, and exit status. A command outside the allowlist ends the run as `failed`. The evaluator does not repair the actor's command.

For r5 `EVAL-M0-001`, actor A and actor B are separate model conversations. Both receive the same basis before either may edit. Each selects every read, edit, add, commit, publish, and observation command through the audited command loop. Their clones share one bare Git origin whose `published` ref initially names the common basis. After both actors independently request `git publish`, the runner opens one asynchronous gate and starts both compare-and-swap pushes to that same ref without an evaluator retry. Shared publication is part of the B0 allowlist. One actor/process failure is retained independently and peer cleanup is bounded; it is never duplicated into a fabricated second result.

For r5 `EVAL-M0-002` through `004`, actor B first chooses and executes at least one allowed basis observation and then explicitly returns `ready`. Only then does the evaluator apply the case's frozen external injection. Actor B must choose and execute at least one further observation before returning its own verdict. The evaluator never supplies a precomputed observation bundle or announces a successful detection.

## Common start and isolation

Each `(arm, case)` uses a new local Git repository copied from the same case fixture and initialized at the same fixture commit. No run may reuse another run's working tree or chat context. Runtime, OS, model, sampling configuration, case revision, CLI commit, and start/end timestamps are recorded in the record. Result bytes are covered externally by the closed integrity manifest, which binds record path, SHA-256, Git blob, first-containing Git commit, protocol revision, and eligibility adjudication; no record claims a self-digest.

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

Every record validates against `results.schema.json` and the semantic validator. Commands are counted, while an ordered trace preserves exact privacy-safe command text and result classification. Version 2 records additionally retain exact privacy-safe actor outputs, a versioned verdict transcript, and explicit adjudication. Version 3 adds stable artifact/build provenance and explicit per-command timeout classification. Version 1 remains structurally readable but cannot reconstruct omitted raw responses; its immutable legacy records also contain historical absolute local paths. r4 version 2 records replaced paths with `<local-path>`, which is privacy-safe but insufficient provenance and therefore ineligible. New r5 records commit neither usernames nor absolute local paths, model weights, full repository-sensitive prompts, nor local dossier contents.

## Frozen cases

The following files are normative for this comparison:

- `cases/same-version-double-writer.md`
- `cases/stale-handoff-after-intervening-work.md`
- `cases/accepted-artifact-changed.md`
- `cases/evidence-digest-mismatch.md`
