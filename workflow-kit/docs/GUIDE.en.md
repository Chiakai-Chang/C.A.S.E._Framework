# C.A.S.E. Workflow Kit: English user guide

C.A.S.E. helps an agent keep the goal, constraints, evidence, and next action available across long tasks and session changes. Use it for work that benefits from saved state; answer a simple question or fix a small typo directly.

The kit combines an Agent Skill with a local, dependency-free Node.js tool. The skill guides the agent's behavior; the tool stores task records. Neither replaces your coding agent, runs a model server, or grants additional permissions. You do not need the repository's older M0 research implementation.

## Install and start

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

The [optional task-notes template](../skills/case-workflow/assets/task-notes.md) covers decisions, worker briefs/results, continuation, and delivery. Copy only useful sections into your existing project notes, outside the reserved `.case-agent` namespace. Do not duplicate fields already maintained by the CLI.

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
node --test workflow-kit/tests/*.test.mjs
```

That command is run from the repository root. Distributed packages intentionally omit the test suite; inspect package contents with `npm pack --dry-run` from the kit directory before distribution.

See [validation evidence and limits](READINESS.md), [host installation](HOSTS.md), and the [full Chinese worked example](WORKFLOW.md). Functional tests establish the behavior they exercise—not universal quality improvements, token savings, or compatibility with every future host version.
