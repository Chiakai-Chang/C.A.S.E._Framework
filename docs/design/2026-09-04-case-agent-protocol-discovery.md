---
title: C.A.S.E. Agent Protocol — Discovery and Living Design Record
status: living-draft
last_updated: 2026-09-04
authority: non-normative
---

# C.A.S.E. Agent Protocol — Discovery and Living Design Record

This document preserves why the redesign exists, what evidence has been examined, which decisions have been accepted, which remain proposed, and which ideas were rejected or deferred. It is intentionally revisable. The future normative protocol specification, schemas, and conformance tests will be separate artifacts.

## 1. Original intent

The original C.A.S.E. idea was to make AI collaboration resemble a disciplined professional investigation team:

- one dossier represents one task;
- instructions act as explicit governing rules;
- progress is visible outside chat history;
- roles and responsibilities are decoupled;
- context and token budget are spent only where needed;
- a small map supports MECE, just-in-time navigation instead of loading the whole repository.

The redesign keeps this intent while removing unsupported guarantees and Pi-specific coupling.

## 2. Why a redesign is needed

The earlier work mixed several different products:

- a host-neutral work protocol;
- Pi configuration and extensions;
- prompt and skill routing;
- runtime guards;
- local-model calibration;
- installer and restore behavior;
- broad multi-agent and autonomous-work claims.

The result accumulated substantial implementation while failing important behavioral goals. The archived Pi harness reports:

- L1, staying aligned with the intended project, was not achieved;
- L2, planning before substantial work, was not achieved;
- L3, maintaining alignment across long cycles, remained unproven;
- individual guards sometimes fired, but that was mechanism evidence rather than product-outcome evidence.

Source: [negative results](../../../CKs_PI_Code_Agent_Harness/docs/experiments/negative-results.md). Portable lessons were also extracted into [lessons from adapter experiments](../../../CKs_PI_Code_Agent_Harness/external/Local-Agent-Workspace/references/lessons-from-adapter-experiments.md).

## 3. Evidence boundaries learned from practice

The redesign must preserve these distinctions:

| Observed fact | What it does not prove |
|---|---|
| Configuration exists | The host loaded it |
| Host loaded an instruction or skill | The agent followed it |
| A guard fired | The agent recovered or quality improved |
| A schema is valid | Cross-file meaning and deliverables are correct |
| A state says review or done | Required artifacts exist |
| An artifact exists | It is useful, correct, or accepted |
| A handoff file was produced | The recipient observed or accepted responsibility |
| Tests pass | The real host runtime or user outcome works |
| Receipts exist | History is complete, authentic, or tamper-proof |

Negative, unproven, unsupported, and host-limited results are first-class outcomes and must remain visible.

## 4. Product principle: quality per unit of burden

C.A.S.E. should reduce cognitive and decision burden while increasing verifiable outcome quality.

The optimization target is not maximum process coverage. It is:

> the highest useful and verifiable quality achievable with the lowest necessary human and agent burden.

Every field, command, state, question, role, reviewer, template, adapter, and check must justify its cost. A mechanism should be removed, deferred, or progressively disclosed when its measured quality or safety benefit does not exceed:

- learning cost;
- recurring context cost;
- number of user decisions;
- workflow latency;
- maintenance and compatibility cost;
- false-block and recovery cost.

Consequences:

- one default path, not a configuration questionnaire;
- one canonical schema, not multiple protocol profiles;
- conditional fields and risk-triggered checks rather than universal ceremony;
- short always-on instructions and just-in-time references;
- automatic low-risk mechanical validation;
- human involvement reserved for values, trade-offs, exceptions, high-risk actions, and subjective acceptance;
- advanced MECE deliberation only when complexity, uncertainty, or impact warrants it.

## 5. Human and agent authority

The working authority model is:

- humans set direction, priorities, value judgments, risk tolerance, and vetoes;
- agents investigate, compare evidence, propose bounded plans, execute approved work, validate results, and surface unresolved judgment calls;
- deterministic tools enforce machine-checkable invariants;
- no model, skill, hook, or adapter may silently expand authority;
- acceptance is bound to an exact submission and becomes stale when covered content changes.

This model aims to move human attention upward without removing human control.

## 6. Accepted decisions

These decisions have explicit user agreement in the design conversation.

### 6.1 Cross-platform core, phased proof

The protocol is designed for Codex, Claude Code, Pi, and future hosts. Cross-platform means shared protocol semantics and conformance, not identical host behavior.

The first proof may be deep on one host, then tested on a second host to falsify portability. All hosts need not ship adapters simultaneously.

### 6.2 No automatic cross-host orchestration in v1

The first release supports human-assigned sequential or parallel work. It does not automatically select agents, start another host, synchronize sessions, or merge concurrent work.

### 6.3 Fixed project namespace

The default and only v1 namespace is `.case-agent/`.

- If absent, initialization may create it.
- If a valid ownership manifest exists, the repository is already initialized and normal resume applies.
- If the directory exists but ownership or protocol compatibility cannot be established, initialization fails closed.
- v1 does not make the namespace configurable because discovery complexity would spread into every caller and adapter.

### 6.4 Layered publication model

The system is divided into:

1. L0 Protocol — normative semantics, schemas, invariants, errors, conformance vectors.
2. L1 Portable Skill — non-normative agent guidance.
3. L2 Reference CLI — deterministic initialization, validation, and narrow state operations.
4. L3 Host Integration — thin Codex, Claude Code, or Pi discovery and packaging adapters.

Dependency direction is one way: host integration to skill to CLI to protocol. A higher layer cannot redefine a lower layer.

### 6.5 Quality per unit of burden

The project optimizes for the highest useful and verifiable outcome quality at the lowest necessary human and agent burden. Process volume, role count, artifact count, and decision count are costs rather than quality proxies.

Routine, reversible work should follow the shortest valid path. Additional review lenses, evidence requirements, human decisions, or workflow stages appear only when risk, uncertainty, irreversibility, blast radius, or external commitment justifies them.

### 6.6 MECE-Autopilot relationship

MECE-Autopilot is prior art and an optional experimental companion, not a C.A.S.E. core dependency. C.A.S.E. may define a small, brand-neutral `decision-challenge` policy that borrows decision framing, distinct review lenses, a strongest counterargument, explicit trade-offs, unresolved issues, and human-reserved judgments.

The policy cannot change dossier state, accept work, grant authority, execute recommendations, or use simulated roles and votes as independent evidence. Its activation and continued inclusion depend on measured quality gain relative to cognitive, context, latency, and maintenance cost.

## 7. Proposed decisions from the three-round review

These have panel convergence but still require explicit user approval in the sectioned design process.

### 7.1 Public-preview release boundary

- L0: Normative Preview.
- L2: Reference Implementation Preview.
- One portable skill: Experimental.
- Project connection helper: Experimental.
- L3 host plugins/packages: not yet supported.

### 7.2 Canonical state

Use an atomic, revision-protected snapshot as the sole current machine truth. Do not use full event sourcing in v0.x.

Proposed structure:

```text
.case-agent/
  manifest.json
  dossiers/
    <opaque-id>/
      dossier.json
      brief.md
      evidence/
      submissions/
      decisions/
      receipts.jsonl
```

- `dossier.json` contains unambiguous machine state.
- `brief.md` contains human-readable objective, scope, constraints, and review criteria.
- submissions and decisions are immutable records bound to exact digests.
- receipts are optional diagnostic hints and never determine state, authorization, acceptance, or recovery.

### 7.3 Single active writer and optimistic concurrency

Each dossier has at most one active writer. Every governed mutation supplies:

- expected revision;
- expected snapshot digest;
- idempotent operation ID.

Conflicts fail with a stable diagnostic. v0.x only promises this behavior on one machine and one local filesystem; separate clones and network synchronization do not receive real-time mutual exclusion guarantees.

### 7.4 Separate validation, submission, and acceptance

Do not collapse progress into a single green `DONE` state.

```text
Checks:      passed | failed | stale | not_run
Review:      working | ready_for_review | changes_requested
Acceptance:  pending | accepted | rejected | stale
```

Mechanical checks establish readiness. The active writer submits an exact revision. A recorded human decision accepts or rejects the exact submission digest. Changes to covered content invalidate earlier evidence and acceptance.

### 7.5 Non-invasive initialization

`case-agent init` creates only `.case-agent/`. It does not modify `AGENTS.md`, `CLAUDE.md`, `.gitignore`, hooks, MCP configuration, plugins, or Pi extensions.

Host discovery is a second, explicit, previewable operation. Any future disconnect operation may remove a managed block only when its current digest still matches what the tool installed; otherwise it stops and produces a manual patch.

### 7.6 Canonical CLI name

The proposed executable is `case-agent`, not bare `case`. The latter is generic, difficult to search, and conflicts conceptually with POSIX shell syntax. Package and registry availability still require final verification before publication.

## 8. Rejected ideas for v0.x

- root-level `CASE.md`, `MAP.md`, `PROGRESS.md`, and numbered framework directories;
- arbitrary custom namespace paths;
- multiple protocol profiles with different validity semantics;
- full event sourcing and projected state;
- multiple concurrent writers to one dossier;
- automatic cross-host orchestration or synchronization;
- lifecycle hooks as core enforcement;
- Pi extensions as a protocol requirement;
- an MCP server;
- automatic environment repair;
- telemetry backend;
- automatic context compaction;
- automatic consensus or agent ranking;
- a single completion badge;
- claims of sandboxing, enterprise readiness, or complete audit history.

## 9. Deferred ideas

- host-specific plugins/packages after the core has a trustworthy oracle;
- optional team-oriented templates that do not change protocol semantics;
- runtime-observed handoff acknowledgements;
- stronger identity and cryptographic acceptance;
- signed or externally anchored audit records;
- multi-machine coordination and semantic merge;
- MCP access for GUI or remote callers;
- host-specific hooks after independent threat review;
- measured support for local and weaker models;
- automatic compaction after a file-based rehydration contract is proven.

## 10. Required failure-oriented tests

The future conformance corpus must include at least:

- initialization changes no byte outside `.case-agent/`;
- namespace ownership collision;
- unsupported major protocol/schema version;
- partial and malformed snapshot;
- Windows crash at each atomic-write boundary;
- two writers racing from the same revision, with exactly one success;
- repeated operation ID is idempotent;
- artifact missing, empty, changed, outside root, or linked through symlink/junction;
- submission without current checks;
- acceptance spoofed by an agent or bound to stale content;
- accepted artifact changed afterward;
- stale or modified handoff capsule;
- receipts missing, duplicated, reordered, truncated, or deleted;
- validator internal exception cannot become valid;
- host discovers a skill but the agent ignores it;
- guard or instruction fires without outcome improvement;
- forced loss of chat history followed by file-only rehydration;
- context and skill-catalog budget overflow;
- Windows/POSIX path, case, line-ending, BOM, and Unicode differences.

Each normative MUST requires a positive and negative vector. Safety- and state-critical logic also requires mutation tests or an explicit residual-risk record.

## 11. Evaluation strategy

Compare scaffolds rather than evaluating only the final package:

| Arm | Purpose |
|---|---|
| B0: natural-language task only | Control condition |
| B1: short protocol instructions only | Isolate prose value |
| B2: protocol plus CLI, no skill | Isolate deterministic tooling |
| B3: protocol plus skill, no CLI | Detect instruction-only false greens |
| MVP: protocol, CLI, experimental skill | Candidate product |

Primary outcomes:

- mechanical definition-of-done pass rate;
- false-success rate;
- corrupted-state rate;
- stale-revision detection;
- handoff omission and state-preservation rate;
- path-escape or unsafe-write rate;
- human correction/intervention rate.

Secondary outcomes include completion rate, latency, cost, retries, and unnecessary refusals. Skill discovery, guard triggers, tool-call counts, and tokens are diagnostic rather than success outcomes.

Every reported result must identify the full model, provider/runtime, quantization, host, protocol, skill, CLI, prompt/tool bundle, OS, fixture revision, sample size, and stopping rule.

## 12. Release gates

Before any reliability claim:

- the deterministic validator must have a red-capable oracle and false-green corpus;
- the same frozen fixture must receive the same invariant verdict across supported OSes;
- a second host must preserve protocol semantics;
- unsupported combinations must fail visibly;
- direct artifact narration cannot substitute for host-observed evidence;
- timeouts and partial runs remain in reported outcomes;
- at least one preregistered comparison against plain Markdown handoff must show outcome lift.

If only L0 plus L2 produces measurable lift, the skill or host integration is not promoted as necessary.

## 13. Context and cognitive-load strategy

The best context is the smallest context sufficient for the next correct action.

- always-on host instructions are a short routing shim;
- one portable skill is loaded only when relevant;
- the skill points to the current dossier and CLI, not the full specification;
- the current view exposes objective, constraints, current revision, evidence gaps, and one next action;
- bulky evidence remains outside model context and is referenced by path and digest;
- handoff contains only the state required to resume;
- complex MECE deliberation is conditional, not mandatory for routine work;
- a weak model receives a lower-entropy interface and executable correction messages rather than a longer prompt.

## 14. Three-round MECE review record

### Roles represented

Product and architecture:

- agent-harness architect;
- protocol and schema designer;
- Codex, Claude Code, and Pi adapter engineers;
- CLI and packaging engineer;
- distributed-workflow architect;
- context-engineering researcher.

Reliability and evidence:

- reliability engineer;
- security and privacy leads;
- evaluation scientist;
- formal-methods reviewer;
- observability engineer;
- local-model benchmarking researcher;
- red-team adversary.

Stakeholders:

- first-time individual developer;
- local/weak-model user;
- advanced cross-platform user;
- team technical lead;
- future maintainer and open-source contributor;
- Windows, macOS, and Linux users;
- enterprise security reviewer;
- documentation and developer-experience reviewers;
- skeptical non-adopter.

### Round 1 — independent decomposition

The panels independently mapped product boundaries, protocol semantics, state and evidence, context cost, platform variance, security, privacy, evaluation, installation, maintenance, adoption, and complete user journeys.

Conflicts included whether full event sourcing was required, whether three adapters must launch together, whether init should modify host instructions, whether profiles were useful, and whether machine checks could decide completion.

### Round 2 — cross-examination

The panels converged on:

- one active writer;
- no protocol profiles;
- non-invasive init;
- explicit host connection;
- machine readiness separated from human acceptance;
- no three-adapter launch requirement;
- four user-facing concepts: dossier, run, evidence, activity/receipts.

The remaining dispute was full event-sourced truth versus a canonical snapshot with receipts.

### Round 3 — final red-team vote

All panels voted for snapshot truth in v0.x, conditioned on atomic writes, revision/digest compare-and-swap, immutable submission digests, stale acceptance, safe handoff semantics, and receipts being explicitly non-authoritative.

All panels returned conditional approval. Failure to satisfy any blocking conformance test changes the decision to reject.

## 15. External research and prior art

- [Cross-platform packaging research](../research/2026-09-04-cross-platform-packaging.md)
- [Anthropic: Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [OpenAI: Harness engineering](https://openai.com/index/harness-engineering/)
- [Lost in the Middle](https://arxiv.org/abs/2307.03172)
- [Agent Skills specification](https://agentskills.io/specification)
- [MCP specification](https://modelcontextprotocol.io/specification/2025-11-25)

- [MECE-Autopilot compatibility audit](../research/2026-09-04-mece-autopilot-fit.md)

## 16. MECE-Autopilot relationship

MECE-Autopilot has strong conceptual overlap with C.A.S.E. in four areas:

- agents should investigate and recommend rather than return low-value technical choices to humans;
- important decisions benefit from non-overlapping review lenses and a serious counterargument;
- trade-offs, unresolved issues, and human-reserved judgments should be explicit;
- reasoning state that matters for later work should be materialized as an artifact.

The current upstream implementation is not suitable as a C.A.S.E. core dependency:

- its broad automatic triggers can impose substantial ceremony on routine decisions;
- simulated roles are review lenses, not independent experts or independent evidence;
- the documented dynamic, unbounded convergence process is not implemented by the current fixed two-cycle orchestrator;
- word-count and keyword validators are vulnerable to formal compliance without semantic quality;
- its installer, global instructions, `wiki/` topology, authority model, and state machine would create a competing source of truth;
- upstream versions are inconsistent across its files and no stable release currently anchors compatibility.

The proposed relationship is therefore:

1. The complete MECE-Autopilot remains an independent, pinned, experimental companion.
2. C.A.S.E. defines a small optional `decision-challenge` workflow or policy without importing the upstream brand or runtime.
3. The policy produces one review artifact and cannot change dossier state, accept work, grant authority, or execute the recommendation.
4. A portable skill may help invoke the policy but remains experimental.
5. Promotion requires a preregistered comparison against ordinary C.A.S.E. work and the full companion.

The minimum decision review contains:

- the decision question and at least two viable candidates;
- hard constraints and success criteria;
- distinct evaluation dimensions and known coverage gaps;
- evidence for and against each candidate;
- the strongest counterargument and what evidence would change the recommendation;
- trade-offs, unresolved issues, and human-required decisions;
- an explicit stop reason and bounded cost.

It should be suggested only when multiple viable options coincide with high irreversibility, blast radius, safety/compliance, external commitment, material budget, or high evidence uncertainty. It should not automatically trigger for routine implementation, a small reversible choice, a clear hotfix, a style preference, or a missing human preference that is best resolved by one high-information question.

This preserves MECE-Autopilot's useful decision discipline while satisfying C.A.S.E.'s quality-per-unit-of-burden principle.

## 17. Open questions

1. Which fields belong in the minimal `dossier.json` and immutable submission envelope?
2. How should the CLI record a human acceptance without falsely implying authenticated identity?
3. Which host should be the first deep implementation target, and which should be the portability falsifier?
4. What is the smallest handoff that survives total loss of chat history without forcing broad repository rereading?
5. What quantitative burden metrics should accompany quality and safety outcomes?
6. What thresholds should recommend `decision-challenge` without turning it into an automatic ceremony?

## 18. Goal-alignment checkpoints

The project must periodically restate its objective and test whether current work directly improves the probability, cost, safety, or clarity of achieving it.

Run an alignment checkpoint:

- after each approved design section;
- before expanding research into another domain;
- before moving from design to implementation;
- when a new tool, adapter, workflow, or dependency is proposed;
- after an experiment or incident changes an assumption;
- before a release or reliability claim.

Each checkpoint records:

1. the current project objective;
2. the user outcome this work enables;
3. the evidence or uncertainty motivating the work;
4. the expected quality, safety, cost, or cognitive-load improvement;
5. the smallest alternative that could achieve the same result;
6. the stop, defer, or removal condition;
7. whether the work belongs in protocol, CLI, skill, host integration, research, or outside the project.

Work that cannot establish a credible link to the objective is stopped, deferred, or moved outside the core. An activity is not justified merely because it is technically interesting, already partially built, or common in other agent frameworks.

## 19. Alignment checkpoint — 2026-09-04

**Current objective**: Produce a practical, general, public protocol that lets human-directed coding agents preserve, validate, and hand off work across limited contexts and different hosts without imposing unnecessary cognitive or decision burden.

**Work completed so far**:

- extracted portable lessons and negative evidence from the archived Pi harness;
- separated protocol, skill, deterministic CLI, and host integration responsibilities;
- defined a non-invasive project namespace and phased cross-platform proof strategy;
- challenged the proposal across architecture, reliability, security, evaluation, user, maintainer, weak-model, enterprise, and cross-OS perspectives;
- researched current host packaging and MECE-Autopilot fit using primary sources;
- recorded accepted, proposed, rejected, and deferred decisions outside conversation history.

**Alignment assessment**: This work directly reduces the chance of repeating the earlier coupling, false-green, prompt-bloat, and unsupported-claim failures. It creates a smaller and more falsifiable path to the stated objective.

**Smallest credible next step**: Complete and approve the domain model, dossier schema, lifecycle, error semantics, and CLI interface before implementing adapters or model-dependent behavior.

**Stop or defer conditions**:

- defer a feature when its benefit cannot be separated from ordinary Markdown plus Git;
- stop adding process when burden grows without outcome-level evidence;
- keep host-specific failures in adapter research unless they change protocol semantics;
- do not expand to orchestration, hooks, MCP, or model optimization before the core oracle is trustworthy;
- revise the product claim if controlled evaluation shows no improvement beyond schema validation.

**Out-of-core work for now**: Repairing the current Pi installation and benchmarking the local llama.cpp model remain useful future test-environment tasks, but they do not define C.A.S.E. protocol semantics.

## 20. Change policy

- This document may change as evidence or user decisions change.
- Every change should distinguish accepted decisions, proposed decisions, rejected ideas, and deferred work.
- Reversal of an accepted decision records the reason and superseded date rather than silently rewriting history.
- Normative language belongs in the future protocol specification, not here.
- Behavioral claims require recorded configuration and outcome evidence.

## 21. Alignment checkpoint — M0 approved on 2026-09-04

The user approved **M0 Local Dossier Integrity** as the next formal specification milestone.

The accepted milestone narrows the next proof to one local dossier journey: create, assign, register criterion-linked evidence, hand off between two recorded actors, submit an exact content/evidence digest, record a human decision, and detect that the decision becomes stale after covered content changes.

The design is recorded in [M0 Local Dossier Integrity Design](../superpowers/specs/2026-09-04-local-dossier-integrity-design.md).

This checkpoint also corrects an earlier assumption: atomic replacement plus expected revision and digest checks is not by itself compare-and-swap. Exactly-one-success among conforming competing writers additionally requires an exclusive dossier writer guard acquired before rereading and checking preconditions. The guarantee is limited to one machine, one supported local filesystem, and cooperating implementations.

Skill packaging, host connection, adapters, MECE deliberation, operation receipts, Pi repair, MCP, hooks, telemetry, multi-machine coordination, and weak-model optimization remain outside M0. They cannot re-enter the core until the deterministic oracle demonstrates outcome-level value over the Markdown baseline.

## 22. M0 specification review and closure — 2026-09-04

The approved M0 design received separate standards, approved-scope, implementation, first-user, conformance, and Windows-path reviews. Review findings were treated as technical hypotheses and checked against the project goal before revision.

The review changed the specification in these material ways:

- reliability improvement is stated as a hypothesis to test, not an achieved result;
- ambiguous `owner` language was removed in favor of recorded process-identity evidence;
- non-essential abandonment, archive, reopen, purge, and handoff-cancellation behavior was removed from M0;
- `content`, observed-evidence, checks, state, and submission digest projections now have separate canonical meanings;
- acceptance criteria distinguish mechanical verification from recorded human review, with explicit evidence-combination rules;
- file evidence uses canonical repository-relative paths without case folding or implicit path selection;
- each dossier-scoped command requires an explicit dossier ID;
- human-mode mutations bind confirmation to the exact displayed revision and digest rather than silently refreshing intent;
- an accepted handoff is linked to the resulting run through `started_by_handoff_id`;
- a decision may target only the current submission;
- governed content changes retain prior submission and decision references so their status becomes stale rather than reverting to pending;
- conformance cases use a closed fixture envelope with deterministic IDs, clocks, invocation data, expected results, and filesystem state.

Two additional review rounds checked the revisions. The standards review, specification review, and stakeholder journey review reported no remaining known blocker within the approved M0 scope.

This closure means the design is ready for implementation planning. It does not prove the protocol works, that the reference implementation will conform, or that C.A.S.E. improves outcomes over Markdown. Those claims remain gated by schemas, executable fixtures, fault injection, cross-profile results, and the preregistered baseline comparison.
