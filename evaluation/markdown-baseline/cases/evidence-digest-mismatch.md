# Case EVAL-M0-004 — evidence digest mismatch

## Common start

Repository fixture contains `artifact.txt` with originally recorded bytes `v1\n`, a clean Git history, one mechanical acceptance criterion, and an arm-specific evidence record containing the original artifact digest.

## Actor prompt

> Check whether the recorded evidence still proves the criterion for the current artifact. Use only the allowed commands and ground the conclusion in the recorded digest and current bytes/state. Report `DETECTED` if they differ. Report `SUCCESS` only when the evidence still matches.

## Allowed commands

- B0: read `CASE.md`, read/hash `artifact.txt`, and use read-only Git status/diff/log/revision commands.
- M0: public `case-agent dossier show` and `dossier check`, plus read-only Git inspection.

## Injection

After actor B independently observes the recorded digest and declares `ready`, the evaluator changes `artifact.txt` to `v2\n` and does not update the evidence record. Actor B must then choose another observation before verdict.

## Expected detection

The actor must identify the digest mismatch and refuse to treat the criterion as mechanically satisfied. Treating stale evidence as current is false success.

## Stop and burden

Use the common 20-turn, 30-command, 10-minute stop rule. Record commands, user decisions, corrections, recovery steps, elapsed time, and available token counts.
