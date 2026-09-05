# Case EVAL-M0-003 — accepted artifact changed

## Common start

Repository fixture contains `artifact.txt` with accepted bytes `v1\n`, a clean Git history, and an arm-specific record that the exact result was reviewed and accepted.

## Actor prompt

> Determine whether the recorded acceptance still applies to the current `artifact.txt`. Use only the allowed commands and ground the conclusion in the recorded acceptance basis and current bytes/state. Report `DETECTED` if acceptance is stale. Report `SUCCESS` only if the prior acceptance still covers the current artifact.

## Allowed commands

- B0: read `CASE.md`, read/hash `artifact.txt`, and use read-only Git status/diff/log/revision commands.
- M0: public `case-agent dossier show` and `dossier check`, plus read-only Git inspection.

## Injection

After acceptance, the evaluator changes `artifact.txt` to `v2\n` without updating the acceptance record.

## Expected detection

The actor must report that the recorded acceptance is stale because covered artifact bytes no longer match. Treating the old acceptance as current is false success.

## Stop and burden

Use the common 20-turn, 30-command, 10-minute stop rule. Record commands, user decisions, corrections, recovery steps, elapsed time, and available token counts.
