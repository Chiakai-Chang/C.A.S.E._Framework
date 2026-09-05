# C.A.S.E. Agent Protocol

> Historical M0 glossary only. For the current Workflow Kit, use [Architecture and terminology](workflow-kit/docs/ARCHITECTURE.md). Revision-bound offers, recipient acceptance, submissions and human-acceptance digests below are not implemented by the Kit.

C.A.S.E. is a file-native work protocol for human-directed, verifiable handoff between coding agents. This glossary defines the domain language; it does not define implementation details or claim that an agent will obey the protocol.

## Work and responsibility

**Work Dossier（工作卷宗）**:
A durable work package containing one objective, its scope, acceptance criteria, current responsibility, evidence, and review state.
_Avoid_: Task folder, ticket, thread, session

**Run（工作回合）**:
One bounded period in which a human or agent works on a dossier. A run belongs to a dossier but is not the dossier itself.
_Avoid_: Attempt, agent session, worker instance

**Active Writer（目前執行者）**:
The single run currently permitted by the protocol to update a dossier's governed work state.
_Avoid_: Owner, lock holder, autonomous agent

**Handoff（交接）**:
An explicit transfer offer tied to an exact dossier revision; responsibility changes only after the recipient accepts a still-current offer.
_Avoid_: Message sent, summary written, agent notified

## Evidence and review

**Evidence（證據）**:
A traceable observation or artifact linked to a specific acceptance criterion and dossier revision.
_Avoid_: Claim, narration, file count, citation count

**Checks（機械檢查）**:
Deterministic validation of structure, declared evidence, revisions, and protocol invariants. Passing checks does not judge the quality or usefulness of the work.
_Avoid_: Approval, completion, review

**Submission（送審）**:
The active writer's declaration that an exact revision and its evidence are ready for review.
_Avoid_: Done, accepted, completed

**Recorded Human Acceptance（已記錄的人工驗收）**:
A human review decision bound to an exact submission digest. It records a decision but does not provide strong identity proof or non-repudiation.
_Avoid_: Automatic approval, cryptographic attestation, permanent correctness

## Protocol structure

**Protocol（協議）**:
The host-neutral rules, schemas, invariants, error semantics, and conformance examples that define valid C.A.S.E. work data.
_Avoid_: Runtime, orchestrator, plugin, prompt

**Portable Skill（可攜技能）**:
Non-normative procedural guidance that helps an agent use the protocol through progressive disclosure. A skill is not an enforcement or security boundary.
_Avoid_: Guardrail, validator, sandbox

**Reference CLI（參考命令工具）**:
The deterministic implementation that initializes and validates protocol data and performs narrowly defined, revision-checked updates.
_Avoid_: Agent runtime, autonomous coordinator

**Host Integration（宿主整合）**:
A thin, host-specific adapter for discovery, installation, or user experience in Codex, Claude Code, or Pi. It must not redefine protocol semantics.
_Avoid_: Cross-platform core, universal plugin

**Operation Receipt（操作收據）**:
A non-authoritative diagnostic record of an attempted or completed mutation. It is not a complete audit trail or recovery source.
_Avoid_: Event source, tamper-proof ledger, canonical history
