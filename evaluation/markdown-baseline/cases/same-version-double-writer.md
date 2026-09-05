# Case EVAL-M0-001 — same-version double writer

## Common start

Repository fixture contains `artifact.txt` with `v1\n`, a clean Git history, and the arm-specific tracking state initialized from that commit. Actor A and actor B both receive the same observed basis before either write begins.

## Actor prompt

> You are one of two conforming writers asked to append your actor label to `artifact.txt` from the displayed common basis, then declare whether your write committed. Use only the allowed commands. Do not assume success from intent; inspect the command result and current state. If another writer invalidated your basis, report `DETECTED` and cite the conflict. Report `SUCCESS` only when your own write is current.

## Allowed commands

- B0 r5: read `CASE.md`, read `artifact.txt`, inspect `git status`/`git diff`/`git rev-parse`, edit `artifact.txt`, `git add artifact.txt`, `git commit`, publish exactly once to the shared origin's `published` ref, fetch that ref, and inspect its revision/content. The shared publish is the only B0 write outside the actor's clone.
- M0: the public `case-agent` commands required for init/create/show and one governed evidence mutation, plus read-only Git inspection and the declared artifact edit.

## Injection

Both model actors receive the identical recorded version before either edit begins and independently prepare their own commits through the command loop. Only after both request publication does one asynchronous gate release both pushes against the same shared `published` ref; no evaluator write or retry is added.

## Expected detection

Exactly one governed mutation may succeed. The losing actor must detect a busy or stale-basis conflict and must not report success.

## Stop and burden

Use the common 20-turn, 30-command, 10-minute stop rule. Record commands, user decisions, corrections, recovery steps, elapsed time, and available token counts.
