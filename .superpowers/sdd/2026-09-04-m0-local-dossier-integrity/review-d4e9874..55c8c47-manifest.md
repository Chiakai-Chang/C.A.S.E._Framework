# Task 11 fix-round-6 review manifest

- Base: `d4e9874acaa550d4d1216e8d884fb64c9454d38f`
- Head: `55c8c47cb7639c4106af6016f41ce8c4c3c6afc7`

Review the actual diff and independently reproduce these boundaries:

- Poisoned timer coercion must not cross ownership; honest public cancellation must remain green.
- A benign completed `Immediate` must be quiescent, while work or network derived from it remains visible.
- Synchronous, `nextTick`, microtask, and `.git` mutations after the first snapshot must turn the case red after final revalidation.
- Runtime capability probes must fail closed when Promise parent semantics or timer/immediate lifecycle observations are incompatible, and must not be controllable by fixture ports.
- Trusted timer cleanup must use the original resource object and module-scope public cancellation functions.
- Existing Promise, resource cleanup, formal script exit, counts, and bounded support claims must remain correct.

Reject stale final-state booleans, private or spoofable cancellation signals, sleeps, leaked hooks, false positives, or support overclaims.
