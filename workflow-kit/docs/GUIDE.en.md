# C.A.S.E. Workflow Kit: English user guide

C.A.S.E. helps an agent keep the goal, constraints, evidence, and next action available across long tasks and session changes. Use it for work that benefits from saved state; answer a simple question or fix a small typo directly.

The kit combines an Agent Skill with a local, dependency-free Node.js core. The v2 preview also includes a pi extension that uses pi's SDK for fresh sessions. It does not run a model server or grant additional permissions. You do not need the repository's older M0 research implementation.

## V2 preview: contracts and fresh sessions

Packet material resolution and pi tools now share protected-path rules: `.case-agent`, `.git`, `.pi`, `.agents`, `.codex`, and `.claude` are excluded at any depth, case-insensitively, including existing packet context. Ordinary `AGENTS.md` remains usable as an explicitly selected instruction source. This closes an inline-material bypass; it is not secret scanning or an OS sandbox. The fix was made after the frozen real-task comparison; that comparison does not measure the repaired version's model performance. Final local regression: 220/220 passed.

The latest real-project adoption-map task failed in both arms: native pi took 81.181 seconds (62,396 SDK tokens), CASE took 596.062 seconds (87,964 tokens), neither produced an acceptable artifact. The same frozen sources and runtime were used without intervention or reruns. This pair demonstrated no quality or cost advantage; do not treat the preview as a reliable unattended worker. See the [real-task report](../../docs/evaluation/2026-09-06-real-task-report.md) for tooling differences and grading limits.

The latest lifecycle repair adds immediate discovery persistence, atomic triage/amendment, same-session artifact/check repair, partial waiting/resume, bounded discovery reads, programmatic handoff, and strict worker reply shapes. Regression: 169/169 passed; independent code review and skill application checks completed. Real local-model successes, failures and timeouts are separately retained in the [repair acceptance report](../../docs/evaluation/case-discovery-repair-report.md) and [evidence](../../docs/evaluation/case-discovery-repair-evidence.json). Program tests do not establish model quality gains; earlier experiments below remain historical observations.

On the same final runtime, discovery 04 completed immediate reporting, prerequisite amendment, both artifacts, independent review and integration in 415.643 seconds (7 sessions). Self-repair 03 completed a real missing-artifact rejection, repair in the same session, review and integration in 63.821 seconds (3 sessions). All 16 shared runtime hashes matched and sources were preserved. Failed probes remain reported; this is not a quality benchmark or a zero-failure guarantee.

**Current recommendation: direct work first, a useful handoff summary next; opt into full CASE only when versioned assignments and independent review records are needed.** A fixed-code local comparison completed six arms: the simple pi SDK workflow passed all three scenarios; CASE passed two and failed one when a worker claimed to write a report but created no file. Successful CASE arms were also slower. This did not demonstrate a quality advantage; multiple files alone are not a reason to decompose work. The baseline shares CASE's scoped tools, and the resume baseline uses two fresh sessions, so it is not unmodified pi-default UX or a universal success-rate estimate. See the [comparison report](../../docs/evaluation/case-value-validation-report.md) and [evidence](../../docs/evaluation/case-value-validation-evidence.json). The comparison version passed 125 regression tests; that does not cancel the model failure.

Use direct work for short tasks, v1 records for lightweight staged continuation, and v2 when versioned contracts and bounded work packets help. Packet work is sequential by default; additional sessions have a cost. See the [Chinese v2 guide](V2.md) and [agent reference](../skills/case-workflow/references/v2-contracts.md). The remaining command walkthrough below is explicitly v1.

For pi, first download the repository with `git clone https://github.com/Chiakai-Chang/C.A.S.E._Framework.git`. Then run this from the project you want to work on, replacing the source path with the absolute download location:

```text
pi install -l "<CASE-download-location>/workflow-kit"
```

Native local installation with pi 0.84.2 and actual SDK loading registered the `case_workflow` tool and `/case` command without loader errors in an isolated project. Native create/run also completed on the real local model in 124.914 seconds with four role sessions, byte-exact output and unchanged input. Native removal also succeeded: CASE was removed from project package settings while case records, deliverables and source-kit SHA256 hashes stayed unchanged. Evidence is in the repository's `docs/evaluation/case-v2-native-evidence.json`; see [READINESS](READINESS.md). The core requires Node 20+; pi 0.84.2 requires Node 22.19+. The package declares the SDK as an optional peer dependency supplied by pi. Installation/removal obey pi project trust. If an untrusted-project error appears, inspect the project and package before approval; noninteractive `--approve` explicitly authorizes that operation, not arbitrary future work. Local installation references the checkout instead of copying it: retain that path, reload after updates, and manage removal with `pi remove -l` using the same path. Do not mix this with a skill-only installer or install duplicate skills. Remote Git installation of this repository root and registry publication are not established routes.

Select the intended model in pi first; for local work verify that its provider is local. Explain the requested outcome normally. The agent creates a contract through `case_workflow` with operation `create`, then runs its returned case ID. The contract has `goal`, `constraints:[{id,text}]`, `acceptance:[{id,text}]`, and `budget:{maxAttempts,maxDurationMs}`. The agent derives these fields from the request; the user need not fill out a form. The installed reference contains a complete JSON example.

```text
/case list
/case show <id>
/case run <id>
/case stop
```

There is no `/case create` command; creation is a tool operation. Planner, worker, reviewer and integrator use separate sessions with the selected model. Worker conversation is not copied into review; pi still loads project instructions. Only workers have scoped file writes. Set contract `writeScope` to the user-authorized ceiling: planning is not permission to expand it. This is not an OS sandbox. Other AI tools can use the portable core, but this kit has no automatic session integration for Codex, Claude Code or Antigravity.

**Project consensus → overall plan → bounded assignment:** optional shared consensus lives in the existing `.case-agent/workflow.json`, not a new generic root filename. Have the agent prepare `{"summary":"Local traceable work","constraints":[{"id":"local","text":"Do not upload project data"}],"sources":["AGENTS.md"]}` using real existing sources. Run `/case project <FILE>` and inspect the confirmation; `/case project` is read-only. New cases inherit the snapshot, including core-added `project:` IDs (do not add that prefix yourself). Source/revision changes block further work with `PROJECT_POLICY_CHANGED`; explicitly update consensus and revise affected cases. The portable CLI offers `project` and `set-project --data FILE --revision N --reason TEXT`, after init. One-off work need not configure this layer.

**Feedback without changing the goal:** workers report obstacles with `blocked` or suggested plan changes with `changeRequest`, each containing a specific `reason`. Both go to a fresh planner for triage; a worker's label does not establish that external intervention is necessary. The planner stops with `blocked` when external input or new authority is genuinely required, otherwise returns a complete replacement `packets` plan, `rerunPacketIds`, and `reason`. Core action `amend_plan` checks authority, dependencies and acceptance coverage. Valid unrelated verified work is retained; changed, overlapping or dependent work is invalidated. Integration failures require actual rework. Both feedback kinds share the existing two-replan limit across runs and original budgets. Unknown side effects still require explicit recovery.

**Real executable checks:** prepare `{"tests":{"command":"node","args":["--test"],"timeoutMs":30000}}`, then use the human command `/case checks <FILE>` and confirm the displayed commands. Unscoped checks run at integration; optional `criterionIds:["a1"]` also runs them for matching packet reviews. The runner records actual exit codes/output and prevents model assertions from overriding failures. Commands execute project code with user permissions: trust includes that code, not just the command name. Approval is in memory for this extension lifetime; `/case checks-clear` clears future approval, and `/case stop` is needed to cancel active work. No list means no claim that tests ran; arbitrary shell commands are not offered to the model.

**Discover work during execution:** use internal `case_discover` with `{key,summary,evidence,impact}` where impact is `blocking` or `nonblocking`. Persistence happens immediately, before final submission. Nonblocking reports let the worker continue; blocking reports stop that worker's tools and hand control to planning. A discovery is a proposal, not authorization or a directly scheduled worker. The planner deduplicates and resolves every pending item using `accepted` (real packet IDs), `duplicate` (a settled direct target), `dismissed`, `deferred` (nonblocking only), or `needs_input`, each with a concrete reason. Core `resolve_discoveries` can atomically apply dispositions and a complete amended plan. Blocking prerequisites must actually be dependencies. Unaffected verified work is retained; independent work may proceed while external input is missing. Unchanged waiting cases do not call the planner repeatedly on resume. Once input arrives, explicitly dispatch `reopen_discovery` with the discovery ID and reason, then run again. Pending/waiting discoveries prevent completion. These are portable collaboration concepts, not GitHub Issue/PR requirements.

Discovery keys deduplicate within their source packet/attempt; conflicting content is rejected, and new evidence uses a new key. Cross-attempt similarity requires an explicit planner decision. Discovery triage does not consume the legacy two-replan allowance but still counts toward original time/session/attempt budgets. The case state upgrades to `case-workflow/2.1` on first discovery; the directory manifest remains `case-workflow/2`. New readers accept both state versions, while old readers reject 2.1. Update all cores sharing a case. See the [complete action reference](../skills/case-workflow/references/v2-contracts.md#執行中發現與待辦處置).

Discovery context uses bounded indexes with explicit 240-character previews, not full evidence/history. Read relevant authoritative records through `case_discovery_read({id,start:0,maxChars:6000})`, following `nextStart` until the needed record is complete; the per-call ceiling is 12000 characters. Do not treat omitted evidence as absent, or join pages from different revisions. Planners/integrators can read discoveries in the current case; workers/reviewers only related packet discoveries. This is read-only, not arbitrary state-file access. Accepted results now trigger programmatic session handoff rather than waiting for the model to decide to stop; late tools remain blocked.

Check tools follow the same stage boundaries: planners receive none, workers/reviewers only checks matching their packet's criterion IDs, and integrators all approved checks. Whole-case checks without criterion IDs are not exposed to prerequisite workers.

Pi child sessions submit their structured reply via `case_result` with `{result: object}` after their work and self-checks. Once accepted, further tools are rejected. Worker submission first awaits core artifact/source validation and matching approved checks; a rejection leaves the same session able to repair within its existing scope and budget. Concurrent tools cannot bypass validation, and final text uses the same validation path. Formal submission and independent review still recheck current evidence. With no approved checks, artifact existence is not a semantic correctness guarantee. Raw final text and transport are retained; the tool is internal, not an additional user setup step.

Planner replies are preflighted against core rules before acceptance, so actionable validation errors can be corrected in the same session without committing state. Final dispatch still checks revisions and source freshness. If a session ends without an acceptable structured reply, the runner asks for a reply correction at most once within the original turn/time budget. It does not do so after cancellation, turn exhaustion, or an accepted reply. `replyCorrections` retains the reason and prior text. Write observations retain the requested path and allowed scope, not the write body; absent fields in older traces remain unknown.

V2 uses `scripts/case-v2.mjs`: `init`, `create --data <contract.json>`, `get --case <id>`, `list`, `dispatch`, and `context --case <id> --packet <packetId>`; all require `--project <project>`. Action JSON is submitted with the current `--revision` and a unique `--request`. Reuse a request ID only for an identical retry. See `--help` and the reference for actions. Do not manually edit authoritative state.

The authoritative case record is `.case-agent/cases/<UUID>/state.json`; run artifacts preserve responses, session/model information, usage and tool observations. Missing costs stay unknown/null. Inputs and submitted deliverables are bound to SHA256 versions. Submission is not verification: a different review session checks actual artifacts, and integration must pass every global criterion. Required context is never silently truncated: `maxChars` is a character budget, and excess returns `CONTEXT_TOO_LARGE`. Required inputs may use `delivery:"indexed"` and `purpose` to retain their version and reading obligation without inlining all content; use paginated reads. Current read limits are 1 MiB per file, 200 lines and 24000 characters per call; larger data needs authorized preprocessing, not silent omission.

On interruption, inspect state and artifacts, confirm the old process stopped, and check partial side effects before retrying. `/case stop` requests cancellation. Valid verified packets can be retained on resume; retrying an upstream packet invalidates downstream verification. Contract changes use `revise` then a new `plan`, conservatively invalidating prior packet and integration passes without resetting cumulative budgets. Repeated local findings return to planning within bounded budgets; no-op or exhausted replans stop. Do not conceal failures through unbounded retries.

V1 `case.mjs` remains available. Existing `case-workflow/1` data requires explicit upgrade intent and `case-v2.mjs migrate --project <project>` after all writers stop. Migration verifies a backup outside `.case-agent` before switching the manifest; preserve its returned backupPath. Legacy tasks remain history, not independent v2 acceptance. Create a new linked case for resumed work. V1 rejection after migration is intentional. Skill updates and removal do not delete cases.

One real local-model CSV smoke succeeded in both modes, but repeated runs also exposed a separated integrator returning an invalid acceptance ID; the core refused completion. All five development pairs and the failure are preserved in the repository's `docs/evaluation/case-v2-local-report.md`; they span implementation changes and are not fixed-version statistics. One pair after format guidance changes passed independent artifact checks in both modes: single context took 23.538 seconds and 6069 SDK total tokens, separated execution took 115.405 seconds and 21198. This simple task showed added cost without a demonstrated quality benefit. That earlier comparison version passed 125/125 tests; current scope and probe failures are recorded in READINESS. The first four feedback probes all failed; the last repeatedly read inputs despite case_write being present in outgoing tool schemas, then exhausted its time budget without artifacts. See [feedback report](../../docs/evaluation/case-feedback-report.md). This is not evidence of universal quality or cost improvements, nor completion of all planned acceptance. Historical v1 CI and package counts below do not establish v2 cross-platform coverage. Subsequent fixes and probes are recorded in the [core repair report](../../docs/evaluation/case-core-repair-report.md): probes 5–8 did not complete; probe 9 with thinking enabled produced exact artifacts but timed out before completing review/integration. The global pi installation is rebuilt; backups remain.

Probe 10 kept thinking enabled and increased only the whole-case time cap to ten minutes. It failed after 328.253 seconds: the report worker repeatedly attempted out-of-scope writes and exhausted 12 turns. The report was not created. Tool-end evidence lacks the requested paths, so their exact values remain unknown; increasing time or enabling thinking is not an established fix. All failures remain recorded; no merge/push or complete-delivery claim follows from these results.

Probes 11–13 also failed: read-only looping, incomplete plan coverage, and prose without an accepted structured reply. After plan preflight and bounded same-session reply correction, probe 14 completed the entire feedback workflow in 489.696 seconds (122831 SDK cumulative tokens): both artifacts were exact, separate reviews and integration completed, and independent checks passed with unchanged source hashes. The planner actually used the reply correction. This is one successful engineering probe, not general reliability or efficiency evidence. Permissions, acceptance and model-server settings were unchanged. See the [follow-up evidence](../../docs/evaluation/case-core-repair-followup-evidence.json); all earlier failures remain preserved.

Probe 15 confirmed full completion with identical code hashes and configuration: 469.135 seconds, 105633 SDK cumulative tokens, seven fresh sessions, exact artifacts and unchanged sources. It needed no reply correction. These two consecutive passes used medium thinking in isolated diagnostics; they do not change global pi settings or establish a universal default. Roughly eight minutes for this deliberately staged simple fixture remains a cost limitation.

Three additional holdouts ran once each: cross-file aggregation passed (88.360 seconds), missing required prices stopped safely without invented output (46.084 seconds), and continuation preserved verified upstream work (62.378 seconds). Raw evidence is in the repository's `docs/evaluation/case-v2-holdout-evidence.json`. The upstream fixture was deterministic test preparation, not a prior model output or a killed-process recovery test. The missing-data run still returned an empty-deliverable plan and an unclear INVALID_ARGUMENT error; a subsequent regression-tested change accepts planner `{blocked:{reason}}` with a non-empty reason, reports BLOCKED and starts no worker. The original model result remains unchanged. These probes do not establish all planned effectiveness criteria.

## V1: why use it, and what is actually established?

A long task can leave its constraints, failed checks, and next action scattered across chat history. CASE keeps a task record in the project so another session can resume from a compact view and consult source files as needed. For example, after a CSV fix is interrupted, the next session can see that empty-input tests still fail and documentation remains unfinished, instead of rebuilding the plan from a long conversation. This is an instructional scenario, not a measured model trial.

Compared with a TODO file, CASE adds consistent fields, executable state transitions, bounded resume output, and a check that all criteria have recorded passing evidence before completion. Reopening resets acceptance so old results are not silently reused. One coordinator integrates workers' outputs; it does not orchestrate different AI products automatically.

These are established workflow ideas packaged together, not a claim of a new agent architecture. The tradeoff is record-keeping effort and a Node.js requirement. Skip it for short tasks or when existing notes already suffice. Success means avoided omissions, repeated explanations, and rework outweigh that effort—not more records or a higher test count.

The code is inspectable and the tool tests have passed the Windows/Linux/macOS × Node 20/24 matrix. That establishes exercised tool behavior, not universal model compliance, token savings, or better task outcomes. Evidence text is not authenticated by the CLI. Your AI tool retains its permissions and may send files it reads to its model provider. Public visibility also does not supply an open-source license; licensing remains undecided. See [validation evidence](READINESS.md) and [architecture](ARCHITECTURE.md).

## Portable skill installation

This installs the portable skill and local core, not the pi extension. The skill routes between v1 and v2; upgrading a skill does not automatically migrate existing task data.

The normal entry point is the established [Vercel Labs Skills installer](https://github.com/vercel-labs/skills), not the internal CASE installer. Run this in your working project (Node.js 20+ and Git required):

```text
npx skills add https://github.com/Chiakai-Chang/C.A.S.E._Framework/tree/main/workflow-kit/skills/case-workflow --copy
```

Select your AI tool and keep project scope. Use `npx skills update case-workflow` / `npx skills remove case-workflow` for that installation. Do not mix installation managers or assume CASE's custom backup guarantees apply to third-party tools. Skills 1.5.23 discovery and copied installation from GitHub were exercised in an isolated project; the local npm exec cache lock failed, so validation used the separately installed CLI. This does not establish model behavior. Pi may see both the shared and Pi-specific copy; check their source if it reports duplicates.

The direct installer below remains an advanced/offline option. Its host table describes that installer, not every third-party installation layout. Antigravity can be selected directly in Skills; the `--host codex` workaround below applies only to CASE's older direct installer.

Requirements: Node.js 20 or newer, an existing project directory, and a host that can read skills or Markdown instructions. Local task commands require no model and no network. A host's model connection is configured separately.

From the kit directory (the directory containing `install.mjs`):

```text
node install.mjs --project "D:/Projects/MyProject" --host pi
```

From the framework repository root, use `node workflow-kit/install.mjs` instead. Replace the example project path with your existing project. Quoted absolute paths work on Windows, Linux, and macOS; use your operating system's actual path. No `npm install` is required for the kit.

Choose the host you use:

| Host | Installed skill | Invocation in the target project |
|---|---|---|
| pi | `.agents/skills/case-workflow/` | `/skill:case-workflow` followed by your request |
| Codex | `.agents/skills/case-workflow/` | `$case-workflow` followed by your request |
| Claude Code | `.claude/skills/case-workflow/` | `/case-workflow` followed by your request |
| Antigravity / agy | Shared `.agents/skills/case-workflow/`; install with `--host codex` | Ask the agent to use `case-workflow`; explicitly read its `SKILL.md` if needed |
| `--host all` | The distinct supported installation locations | Use your host's invocation |

See [host support and maintenance](HOSTS.md) for the source-checked host paths and limitations. There is no dedicated `--host agy` option: Antigravity uses the existing shared-directory installation. Its native loading and model behavior have not been tested here. Installation compatibility is not a claim that every host and model has been tested end to end; [validation evidence](READINESS.md) separates those cases.

Open or reload your host in the target project and check that `case-workflow` is available. For example, tell it:

> Use case-workflow to fix CSV export. Commas, quotes, newlines, and empty input must have passing tests. Preserve column order and the public interface. Update the README example. Do not add runtime dependencies.

The agent should derive the record from your request, do the work, and report evidence—not make you fill out another form. If automatic discovery is unavailable, explicitly ask the agent to read the installed `SKILL.md`. This is a manual fallback, not proof of native integration.

The installation is self-contained: scripts, references, and the optional template are copied together. It does not rewrite your project's `AGENTS.md` or `CLAUDE.md`, global agent settings, credentials, or model configuration.

## Understand the four parts

| Part | Responsibility |
|---|---|
| Host, such as pi | Model execution, tools, permissions, session management, and any subagents |
| `SKILL.md` and references | How to pursue the goal, preserve context, delegate, and verify proportionately |
| `scripts/case.mjs` | Validate and update local task records; produce a compact resume view |
| Project files and evidence | The actual deliverable, tests, observations, and supporting material |

Only one coordinator should update a project's task records at a time. Workers return results to that coordinator. Sharing records across hosts means sequential continuation of the same task—not automatic cross-product messaging or concurrent orchestration.

## Work through a task

The agent normally runs these commands for you. They are also available directly for inspection, troubleshooting, and manual use.

In the commands below, replace `<cli>` with the absolute path to the installed `scripts/case.mjs`, `<project>` with your project directory, and `<id>` with the UUID returned by `new`. Do not type the angle-bracket placeholders literally.

### 1. Initialize and define the outcome

```text
node "<cli>" init --project "<project>"
node "<cli>" new --project "<project>" --title "Fix CSV export" --goal "Export special characters correctly and document usage" --criterion "Special characters and empty input pass export tests" --criterion "Public interface and column order remain unchanged" --criterion "README example runs successfully" --constraint "Do not add runtime dependencies"
node "<cli>" list --project "<project>"
```

Initialization creates `.case-agent/workflow.json` and `.case-agent/tasks/`. Repeating it on valid kit-owned state is safe. It refuses a conflicting namespace, including old M0 records; there is no automatic migration.

Read only the files needed for the next useful action. Modify the actual deliverable and run relevant checks. The CLI does not perform those steps itself.

### 2. Preserve failures and checkpoint meaningful progress

```text
node "<cli>" record --project "<project>" --task "<id>" --criterion 1 --result fail --evidence "Empty-input export test produces an extra blank row; special-character cases pass"
node "<cli>" checkpoint --project "<project>" --task "<id>" --summary "Special-character handling fixed; empty input still fails. README not yet updated" --next "Fix the empty-input branch in src/export.js and rerun export tests"
```

Record observations you actually made. Keep detailed logs or large evidence in ordinary project files and refer to their paths. Do not weaken acceptance criteria to turn a failure into a success.

When blocked, save the exact obstacle and what would unblock it:

```text
node "<cli>" checkpoint --project "<project>" --task "<id>" --status blocked --summary "Required test fixture is unavailable; output remains unverified" --next "Obtain the authorized fixture, then rerun the export tests"
```

A later checkpoint with `--status active` records resumed work. Checkpoints are for meaningful boundaries, not every tool call.

### 3. Resume with limited context

Before compacting or changing sessions, save the current result, unresolved work, and concrete next action. Give the next session the project path, task ID, and skill location.

```text
node "<cli>" context --project "<project>" --task "<id>"
node "<cli>" show --project "<project>" --task "<id>"
```

Start with `context`. It contains the current goal, constraints, acceptance, summary, and next action without event history. If it warns that fields are truncated, read the full `show` output before acting, especially the goal and constraints. Then inspect the referenced source files as needed and check whether they changed since the checkpoint.

The CLI does not compact the host's context or open another session. A record is a continuation aid, not a substitute for inspecting current project reality.

### 4. Delegate only useful independent work

Use an authorized host subagent when a bounded task can run independently—for example, have a worker update documentation while the coordinator fixes implementation. Without subagents, do the same work sequentially.

A sufficient worker brief is:

> Update only the CSV usage section in README.md. Read the public interface in src/export.js. Include a runnable example containing a comma. Preserve the existing interface and add no dependencies. Return changed file locations, actual verification, and limitations. Do not edit .case-agent. Stop and report if the interface is unclear.

The coordinator reviews the returned result against the final implementation and integrates it. A worker's statement that tests passed is not independently verified evidence unless the actual result is checked.

For an entire-task handoff:

```text
node "<cli>" handoff --project "<project>" --task "<id>" --to "Next project session" --summary "Implementation fixed; documentation result awaits integration; acceptance is incomplete" --next "Check README against src/export.js, then run affected tests"
```

`handoff` records the recipient and continuation details, preserves existing evidence, and sets the task active. It sends no message and does not stop the previous agent. Ensure the previous writer has stopped, then pass the project path and ID through the host yourself or through an authorized host capability.

### 5. Verify and finish

Only after actually performing the corresponding checks, record their results. The following evidence text is illustrative; replace it with observations from your real task.

```text
node "<cli>" record --project "<project>" --task "<id>" --criterion 1 --result pass --evidence "Export tests executed successfully, including commas, quotes, newlines, and empty input"
node "<cli>" record --project "<project>" --task "<id>" --criterion 2 --result pass --evidence "Interface regression checks passed and column ordering was checked against the previous implementation"
node "<cli>" record --project "<project>" --task "<id>" --criterion 3 --result pass --evidence "README example executed in the project environment and matched the documented output"
node "<cli>" finish --project "<project>" --task "<id>" --summary "CSV export fixed, interface preserved, runnable example added; all three criteria have evidence"
```

Criterion numbers start at 1. `finish` refuses completion until every criterion has recorded passing evidence. It does not run tests, authenticate evidence, or mean that a human approved the work. Deliver the result location, how to use it, what was checked, and important limitations to the user.

### 6. Reopen defects or separate new scope

```text
node "<cli>" reopen --project "<project>" --task "<id>" --reason "A CRLF input fails although LF input passed"
```

Reopening is only for completed tasks. It resets every criterion to pending and clears its current evidence, so acceptance must be checked and recorded again. Old observations may remain in the bounded event history; retain important evidence elsewhere.

For a different requested outcome, such as adding XLSX export, create a new task and reference the old ID in its checkpoint. Do not reopen a completed task merely to add a backlink, and do not silently rewrite the old outcome or acceptance.

## Optional notes and templates

The [optional task-notes template](../skills/case-workflow/assets/task-notes.md) covers intent and boundaries, decisions, worker briefs/results and self-checks, discoveries, continuation, and delivery. Report discoveries during execution with evidence and impact, not only at the end. Reference the existing v2 discovery ID instead of maintaining a second queue; skill-only work uses existing project notes and available communication tools. Copy only useful sections outside the reserved `.case-agent` namespace. Do not duplicate CLI fields or require GitHub Issue/PR creation.

An English minimal note can be:

```text
Task ID:
Decision: choice / reason / supporting source / what would change the decision
Worker: deliverable / inputs / allowed edits / stop condition
Result: artifact references / actual checks / unresolved limitations
Continuation: current state / next concrete action / constraints that must survive
Delivery: outcome location / usage / acceptance evidence / remaining limitations
```

There is no required role count, meeting cadence, or weekly review. At meaningful changes or delivery, assess whether the workflow preserved necessary context and reduced rework or user burden. Record a lesson only when it changes a decision; unknown costs remain unknown.

## Update and uninstall

From a current copy of the kit:

```text
node install.mjs --project "<project>" --host pi --update
node install.mjs --project "<project>" --host pi --uninstall
```

Use the same supported host selection as installation. An unchanged version is reported as unchanged. Managed files are checked against `.case-install.json`; modified or foreign content is refused rather than overwritten. Preserve custom work separately before resolving a conflict.

Updates and removals move the old skill to a backup under the host directory, such as `.agents/case-workflow-backups/<id>/` or `.claude/case-workflow-backups/<id>/`. The installer reports the location. These backups are outside the normal skills discovery directory. To restore, first move the current installation aside and restore a complete backup; do not merge versions by hand.

Removing a shared `.agents` installation affects hosts sharing that entry, including pi and Codex. Uninstall preserves task records, deliverables, other skills, and model configuration. It does not erase `.case-agent`.

## Troubleshooting

| Symptom | Action |
|---|---|
| Skill not listed | Open the correct project, reload the host, check trust/skill settings and duplicate names. Use explicit `SKILL.md` reading as a fallback. |
| `INVALID_ARGUMENT` | Run `node "<cli>" --help`; check required options, UUID, 1-based criterion number, and text limits. |
| Missing project or task file | Confirm the absolute project path and obtain the ID with `list`; initialization and task creation are separate steps. |
| `ACCEPTANCE_INCOMPLETE` | Inspect `show`; perform missing checks and record real evidence. Do not bypass the criterion. |
| `REOPEN_REQUIRED` | Reopen a completed task only for actual follow-up work; expect to revalidate every criterion. |
| `BUSY` | Check for a running writer. Do not remove a lock while a writer may be active. |
| `NAMESPACE_CONFLICT`, `INVALID_STATE`, or partial initialization | Back up the affected state, inspect the error, and identify foreign, incomplete, or damaged content. Do not force overwrite or assume M0 migration exists. |
| Linked path or junction rejected | Use a regular project directory and regular skill/state directories; do not bypass the path check. |
| Update refuses modified files | Preserve your customizations and compare them with the supplied kit before replacing an installation. |
| Host itself fails on a missing module | Diagnose the host installation separately. The Node CLI can still operate; do not clear global credentials or models to install this kit. |

For a read-only state diagnosis:

```text
node "<cli>" doctor --project "<project>"
```

An interrupted task writer can leave `.case-agent/.write-lock`; an interrupted installer can leave `.case-workflow-install.lock` under the affected host directory. Only after confirming all relevant processes have stopped and inspecting/backing up state should a person handle a stale lock. `doctor` diagnoses, not repairs. An interrupted multi-host install may be partially complete; inspect each destination before rerunning it.

## Data, security, and scope

- Task state is `.case-agent/workflow.json` and `.case-agent/tasks/<UUID>.json`. Keep unrelated notes out of this reserved namespace.
- Text fields allow up to 2,000 characters; a task allows 1–20 acceptance criteria and up to 20 constraints. Use references for large source material.
- `context` truncates individual displayed fields beyond 240 characters and warns; `show` returns full current state. Neither is a guarantee that the model has understood the task.
- Only the latest 30 events are retained. This is not a permanent audit log. Keep valuable evidence in durable source files or your normal project history.
- Commands generally return JSON; `context` and help return readable text. Errors return JSON with a nonzero process exit status.
- Local commands need no network, but your host may send anything it reads to its configured model provider. Do not store secrets unnecessarily; decide deliberately whether task data belongs in version control.
- Writes use a cooperative lock and temporary-file replacement. This is not hostile-process protection, strong identity, tamper-proof evidence, guaranteed power-loss recovery, or a multi-machine database.
- Different hosts may resume the same local task sequentially. Different machines require separate synchronization, with no simultaneous writers. Avoid concurrent writes through synchronized folders.
- The kit does not automatically dispatch agents, launch models, execute tests, enforce a host sandbox, approve actions, or publish your work.

## Verification and further reading

For a source checkout containing tests:

```text
npm test --prefix workflow-kit
```

That command is run from the repository root. Distributed packages intentionally omit the test suite; inspect package contents with `npm pack --dry-run` from the kit directory before distribution.

See [validation evidence and limits](READINESS.md), [host installation](HOSTS.md), and the [full Chinese worked example](WORKFLOW.md). Functional tests establish the behavior they exercise—not universal quality improvements, token savings, or compatibility with every future host version.
