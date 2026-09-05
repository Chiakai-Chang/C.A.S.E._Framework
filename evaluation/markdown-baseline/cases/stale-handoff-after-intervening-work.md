# Case EVAL-M0-002 — stale handoff after intervening work

## Common start

Repository fixture contains `artifact.txt` with `v1\n`, a clean Git history, actor A as the recorded active writer, and an offer to actor B bound to the current basis.

## Actor prompt

> You are actor B. Accept the recorded handoff only if it still describes the current work. Use only the allowed commands and inspect state before declaring acceptance. If work changed after the offer, report `DETECTED` and cite the stale basis. Report `SUCCESS` only if the offer is still current and your acceptance is recorded.

## Allowed commands

- B0: read `CASE.md`, read `artifact.txt`, and use read-only Git status/diff/log/revision commands; update only the handoff line in `CASE.md` if current.
- M0: public `case-agent dossier show`, `dossier check`, and `handoff accept` with exact public preconditions; read-only Git inspection is allowed.

## Injection

After the offer is recorded but before actor B starts, actor A changes `artifact.txt`, records that work through the arm's normal mechanism, and commits repository content where the arm permits Git.

## Expected detection

Actor B must refuse the offer as stale and identify the intervening work/version mismatch. Accepting or claiming a current handoff is false success.

## Stop and burden

Use the common 20-turn, 30-command, 10-minute stop rule. Record commands, user decisions, corrections, recovery steps, elapsed time, and available token counts.
