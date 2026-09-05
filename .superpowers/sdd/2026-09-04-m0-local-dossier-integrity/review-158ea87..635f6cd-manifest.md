# Task 11 fix-round-3 review manifest

- Base: `158ea87a33d855bd205d4881e2d624de2559dcd6`
- Head: `635f6cd124544945ff5baea8c921ac6be50ab0b9`
- Scope: close the second independent re-review findings.

## Must independently verify

1. Final assertion hooks cannot evade the completion quiescence check.
2. Case-created delayed work, `TCPSERVERWRAP`, `DNSCHANNEL`, and worker-pool callbacks that later initiate DNS turn the corpus red without arbitrary sleeps; baseline/test-runner resources do not cause false positives.
3. Envelope address identity, dossier identity, revision direction, digest/basis coherence, and current-versus-history classification fail closed across handoff/submission/decision.
4. `.keep` is no longer a production scanner exception and empty fixture directories are represented without weakening the production topology.
5. `@fixture replace` runtime references are included in the closed reference audit.
6. `actor_label` alone cannot distinguish behavior-identical cross-polarity fixtures.
7. Counts, rule/binding semantics, and remaining external limitations are truthful.

## Claimed verification

- Focused: 56/56 pass, zero skip/todo.
- Full check: typecheck clean, 294/294 pass, zero skip/todo.
- Standalone corpus: 139/139, no uncovered directions.

Review actual code, fixtures, and tests. Do not rely on this manifest or the implementer report as proof.
