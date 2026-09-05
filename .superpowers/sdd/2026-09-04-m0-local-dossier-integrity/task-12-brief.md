# Task 12 brief — frozen B0/M0 evidence and preview boundary

## Base and scope

- Start from `55c8c47cb7639c4106af6016f41ce8c4c3c6afc7`.
- Follow Task 12 in `docs/superpowers/plans/2026-09-04-m0-local-dossier-integrity.md` and the approved M0 specification.
- Work only in `.worktrees/m0-local-dossier-integrity`.
- Preserve the deliberate boundaries: controlled-test is not production support; Windows production returns `CASE_E_UNSUPPORTED_PROFILE`; POSIX is unclaimed; no skill/plugin/host orchestration is added.

## Required deliverables

1. Freeze, before execution, four cases with identical B0/M0 starts, prompts, allowed commands, stop rules, burden fields, expected detection, and timeout:
   - same-version double writer;
   - stale handoff after intervening work;
   - accepted artifact changed;
   - evidence digest mismatch.
2. Freeze B0 as Markdown + Git and M0 as protocol + public CLI without a skill.
3. Add a closed result schema and immutable per-run records. Never omit failed, timed-out, partial, or invalid runs.
4. Execute both arms under the same actor/model/runtime when possible. Record exact model/server configuration, repository/fixture revisions, OS, Node, CLI commit, sample size, stopping rule, elapsed time, commands, corrections, user decisions, and token counts when available.
5. A production M0 run on this Windows host is expected to be `invalid` because the public CLI deliberately rejects the unsupported profile. Record that honestly; do not substitute controlled-test evidence or call it a successful M0 baseline.
6. If practical, use the user-authorized local llama.cpp server launched by `C:\models\Qwen3.8-27B-Orcarouter_ROCmFP4_STRIX_LEAN.bat` for both arms. First inspect whether it is already running and the batch configuration. Do not alter the user's model installation. If launch or stable measurement is unavailable, record the run as invalid with the exact reason rather than inventing results.
7. Create bounded preview README/help covering local package installation, exact commands, offline/data footprint, recovery and identity limitations, audit/sandbox boundaries, and only proven support profiles.
8. Close `M0-OFFLINE-008` only through a real bundled human help surface and packaging evidence; update rules/bindings/cases/tests truthfully. Do not use a decorative scanner.
9. Verify `npm ci`, full checks, conformance, and `npm pack --dry-run`; package must contain only the allowlisted runtime/docs/schemas and exclude tests, evaluation data, secrets, caches, and local dossiers.
10. Append the dated alignment checkpoint and an evidence-based advance/narrow/stop decision. Do not infer a reliability, cross-platform, weak-model, or enterprise-readiness claim from implementation effort.

## Method and review

- Use TDD for executable help/package/conformance changes.
- Keep preregistration history auditable: commit or otherwise freeze case/protocol/schema definitions before recording outcomes, then record execution in a later commit. If a two-commit sequence is needed, do it.
- Produce a task report with exact commands/results, invalid-run explanations, package file list, and remaining gates.
- Do not push, merge, publish, or repair/reset Pi.
