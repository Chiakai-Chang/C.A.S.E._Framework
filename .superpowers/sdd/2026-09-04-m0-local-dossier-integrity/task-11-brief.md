# Task 11 Brief — Build the frozen conformance corpus

## Base and mandate

- Start exact reviewed HEAD `5dca6ce51304a8697df1cd51e3bd5d708984a99c`.
- Work only in the isolated worktree.
- Implement Task 11 completely with strict RED/GREEN. Do not alter the normative spec/plan to make fixtures pass.
- This is a red-capable oracle, not a collection of decorative JSON examples.

## Required files/interfaces

Create:
- `conformance/schema/case.schema.json`
- `conformance/schema/rules.schema.json`
- `conformance/rules.json`
- `conformance/cases/positive/walking-skeleton/**`
- `conformance/cases/negative/**`
- `src/conformance/runner.ts`
- `scripts/run-conformance.mjs`
- `tests/conformance/corpus.test.ts`

Export:
```ts
interface CorpusSummary {
  total: number; passed: number; failed: number;
  uncovered_positive: string[]; uncovered_negative: string[];
}
runCorpus(corpusRoot: string, ports?: CorpusPorts): Promise<CorpusSummary>
```

Update package scripts so `conformance` builds then runs the one compiled runner and `check` runs typecheck, tests, and conformance.

## Normative ledger

1. Independently enumerate every normative MUST/required/fail-closed invariant in spec sections 6–24. Assign stable MECE IDs and preserve exact source section plus a faithful closed statement. Do not omit rules merely because the current implementation lacks support.
2. `rules.json` is schema-validated and contains only `rule_id`, `source_section`, `statement`, `requires_positive`, `requires_negative`.
3. Every required direction must be covered by an actually executed case whose assertions materially discriminate that rule. Folder polarity (`positive`/`negative`) determines direction.
4. Coverage labels are not evidence by themselves. Self-audit each case-to-rule link; do not attach unrelated IDs merely to clear uncovered arrays.
5. Add a test proving an uncovered required direction makes the runner fail/return it, and schema-invalid/duplicate/unknown rule references make the corpus fail closed.

## Frozen case contract

Encode every field in spec §22.1, recursively `additionalProperties:false`, explicit required fields, stable ordering/grammar, and safe corpus-relative content references. Reject traversal, absolute/drive/UNC/backslash ambiguity, duplicate paths, digest mismatches, implicit expected values, mismatched invocation/expected counts, unsupported fixture version, and unknown fault/profile labels.

Runner must:
- load/strict-parse/schema-validate ledger and cases;
- verify all referenced input/expected files remain inside the corpus and their declared digests;
- copy initial trees to fresh temp repos with no path escape/symlink trick;
- fix clocks, IDs, locale, process identity, environment, and deterministic platform adapters;
- execute ordered and concurrent invocations through the same CLI dispatcher/workflows;
- inject only named fault points;
- compare exact exit/code/stdout/stderr, final tree digest set, and derived view;
- enforce exactly-one-success concurrency constraints;
- emit exactly `{total,passed,failed,uncovered_positive,uncovered_negative}` JSON and nonzero on mismatch;
- clean temp state without mutating corpus/source.

Use one TypeScript runner implementation; script is only a thin compiled import.

## Required executed families

At minimum implement every named plan case:
- init-clean, init-foreign, init-partial
- json-duplicate, json-number, json-bom, schema-unknown, jcs-unicode
- writer-same-basis
- retry-immediate, operation-reuse-different-input, retry-old-basis
- every named immutable-envelope/snapshot fault point
- guard-live, guard-dead, guard-unknown
- evidence-missing, empty, changed, external, symlink, junction, alias
- handoff-stale, wrong-recipient, double-accept, replacement, old-writer
- submit-failed-check, submit-open-handoff, submit-inactive-run
- decision-no-tty, decision-old-submission, acceptance-stale
- version-newer, state-unknown, critical-field-unknown, validator-throws
- show-context-loss
- crlf, key-order, unicode-nfd, case-alias, separator
- walking-skeleton-offline with zero network calls

Add any other positive/negative cases needed for honest ledger closure. Cases may invoke a narrowly defined deterministic internal probe only for protocol primitives not exposed by an approved CLI command, but the invocation kind/expectation must remain explicit and the runner must execute it—not infer pass from fixture metadata.

## Platform truth

- Name injected capability `controlled-test` or equivalent and identify it as a test profile only.
- Do not list it as production Windows/POSIX support.
- Production Windows remains `CASE_E_UNSUPPORTED_PROFILE`.
- Corpus passing under controlled adapters does not satisfy the real-platform release gate; report this limitation.
- No environment/CLI test backdoor may reach controlled ports from the shipped executable.

## Mutation/red capability

Add at least one explicit validator/fault mutation test that proves state-critical corruption turns a previously passing case red. Also prove changing expected stdout/tree/view causes mismatch. Do not implement a runner that trusts expected files or fixture-declared pass flags.

## Tests and verification

- Start with schema/ledger plus one namespace-collision case and demonstrate RED.
- Focused corpus tests, then `npm run conformance`.
- Full `& 'C:\Program Files\nodejs\npm.cmd' --cache .npm-cache run check`.
- Zero failed/skipped/todo; uncovered arrays empty.
- Record exact ledger rule count, case count/family count, corpus summary, mutation evidence, and limitations in ignored `task-11-report.md`.
- Commit all tracked corpus/runner/script/package changes as `test: add the M0 conformance corpus`.
