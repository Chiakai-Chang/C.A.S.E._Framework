import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { EXIT_BY_CODE } from "../../src/protocol/errors.js";
import { failure, success, type ResultEnvelope } from "../../src/protocol/result.js";
import type { CurrentView } from "../../src/protocol/types.js";
import { parseCliRequest } from "../../src/cli/args.js";
import {
  basisConfirmationPrompt,
  decisionConfirmationPrompt,
  decisionConfirmationText,
  exactConfirmation,
  recoveryConfirmationPrompt,
  recoveryConfirmationText,
  runCli,
  TtyTerminal,
  type CliDependencies,
  type CliTerminal,
} from "../../src/cli/main.js";
import { SchemaRegistry } from "../../src/protocol/schema-registry.js";
import { CaseStore } from "../../src/storage/store.js";
import { nodePathInspection } from "../../src/storage/paths.js";
import { recoverWriterGuard } from "../../src/storage/guard.js";
import { createDossier, showDossier, type DossierDirectoryPublicationPort, type WorkflowPorts } from "../../src/workflows/dossier.js";
import { addEvidence, checkDossier } from "../../src/workflows/evidence.js";
import { acceptHandoff, offerHandoff } from "../../src/workflows/handoff.js";
import { createSubmission } from "../../src/workflows/submission.js";
import { recordDecision } from "../../src/workflows/decision.js";
import { initRepository, nodeRepositoryFileSystem } from "../../src/workflows/init.js";
import { controlledAtomicFs } from "../helpers/fault-port.js";
import { DECISION_CONFIRMATION_PHRASE } from "../../src/cli/confirm.js";
import { renderHuman } from "../../src/cli/render.js";

const digest = `sha256:${"a".repeat(64)}`;
const basis: CurrentView = {
  dossier_id: "dossier-a", title: "A", objective: "B", scope: null, constraints: null,
  active_run: { run_id: "run-a", actor_id: "actor-a", started_by_handoff_id: null },
  state_revision: "4" as CurrentView["state_revision"], state_digest: digest as CurrentView["state_digest"],
  criterion_results: [], evidence_gaps: [], current_checks: "passed", review: "working",
  acceptance: "pending", handoff: "none", recommended_next_action: "CASE_NEXT_CREATE_SUBMISSION",
  unresolved_warnings: [],
};

class Terminal implements CliTerminal {
  readonly interactive = true;
  readonly basis: CurrentView[] = [];
  async confirmBasis(view: CurrentView): Promise<boolean> { this.basis.push(view); return true; }
  async confirmDecision(): Promise<boolean> { return true; }
  async confirmRecovery(): Promise<boolean> { return true; }
}

function dependencies(calls: Array<{ command: string; request: unknown }>): CliDependencies {
  const invoked = (command: string) => async (request: unknown): Promise<ResultEnvelope<unknown>> => {
    calls.push({ command, request });
    return success(command, "ok", { command });
  };
  return {
    cwd: "C:/repo",
    terminal: new Terminal(),
    workflows: {
      init: invoked("init"), createDossier: invoked("dossier.create"), showDossier: async (request) => {
        calls.push({ command: "dossier.show", request });
        return success("dossier.show", "Current dossier", basis);
      },
      checkDossier: invoked("dossier.check"), addEvidence: invoked("evidence.add"),
      createSubmission: invoked("submission.create"), recordDecision: async (request) => {
        const value = request as { decision: "accepted" | "rejected" };
        return invoked(value.decision === "accepted" ? "decision.accept" : "decision.reject")(request);
      },
      offerHandoff: invoked("handoff.offer"), acceptHandoff: invoked("handoff.accept"),
      recoverGuard: invoked("guard.recover"),
    },
  };
}

test("machine parsing requires an exact dossier mutation basis", () => {
  const missing = parseCliRequest(["--json", "submission", "create", "--dossier", "dossier-a", "--operation", "op", "--run", "run-a"]);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "CASE_E_USAGE");
  const parsed = parseCliRequest(["--json", "submission", "create", "--dossier", "dossier-a", "--operation", "op", "--run", "run-a", "--expected-revision", "4", "--expected-state-digest", digest]);
  assert.equal(parsed.ok, true);
  const recovery = parseCliRequest(["--json", "guard", "recover", "--dossier", "dossier-a", "--operation", "op"]);
  assert.equal(recovery.ok, false);
});

test("single equals-form options work and every duplicate form is rejected", () => {
  assert.equal(parseCliRequest(["dossier", "show", "--dossier=dossier-a"]).ok, true);
  for (const argv of [
    ["dossier", "show", "--dossier=a", "--dossier=b"],
    ["dossier", "show", "--dossier=a", "--dossier", "b"],
    ["dossier", "show", "--dossier", "a", "--dossier=b"],
  ]) assert.equal(parseCliRequest(argv).ok, false, argv.join(" "));
});

test("unknown, forbidden, duplicate, malformed, and positional arguments are usage errors", () => {
  const cases = [
    ["archive"], ["dossier", "show"], ["dossier", "show", "--dossier", "../bad"],
    ["dossier", "show", "--dossier", "a", "extra"], ["dossier", "show", "--dossier", "a", "--dossier", "b"],
    ["dossier", "show", "--dossier", "a", "--yes"],
    ["submission", "create", "--dossier", "a", "--operation", "bad/op", "--run", "run-a"],
    ["evidence", "add", "--dossier", "a", "--operation", "op", "--run", "run-a", "--evidence", '{"kind":"file","criterion_ids":["c"],"freshness":"recompute_on_check","limitations":[],"location":{"repository_relative_path":"../escape"}}'],
    ["evidence", "add", "--dossier", "a", "--operation", "op", "--run", "run-a", "--evidence", '{"kind":"file","criterion_ids":["c"],"freshness":"recompute_on_check","limitations":[],"location":{"repository_relative_path":"a\\\\b"}}'],
    ["evidence", "add", "--dossier", "a", "--operation", "op", "--run", "run-a", "--evidence", '{"kind":"external_reference","criterion_ids":["c"],"freshness":"immutable","limitations":[],"location":{"uri":"https://example.test"}}'],
    ["evidence", "add", "--dossier", "a", "--operation", "op", "--run", "run-a", "--evidence", '{"kind":"human_observation","criterion_ids":[],"freshness":"human_review","limitations":[],"location":{"statement":"seen"}}'],
  ];
  for (const argv of cases) {
    const parsed = parseCliRequest(argv);
    assert.equal(parsed.ok, false, argv.join(" "));
    if (!parsed.ok) assert.equal(parsed.code, "CASE_E_USAGE");
  }
});

test("all eleven commands dispatch with stable public identities and typed requests", async () => {
  const commands: readonly string[][] = [
    ["init", "--operation", "op"],
    ["dossier", "create", "--operation", "op", "--actor", "a", "--title", "t", "--objective", "o", "--brief", '{"scope":{"in":[],"out":[]},"constraints":[],"acceptance_criteria":[{"criterion_id":"c","statement":"s","verification":"mechanical"}]}'],
    ["dossier", "show", "--dossier", "dossier-a"], ["dossier", "check", "--dossier", "dossier-a"],
    ["evidence", "add", "--dossier", "dossier-a", "--operation", "op", "--run", "run-a", "--evidence", '{"kind":"human_observation","criterion_ids":["c"],"freshness":"human_review","limitations":[],"location":{"statement":"seen"}}'],
    ["submission", "create", "--dossier", "dossier-a", "--operation", "op", "--run", "run-a"],
    ["decision", "accept", "--dossier", "dossier-a", "--operation", "op", "--submission", "s", "--submission-digest", digest, "--reviewer", "r", "--criteria", '["c"]', "--comment", "ok"],
    ["decision", "reject", "--dossier", "dossier-a", "--operation", "op", "--submission", "s", "--submission-digest", digest, "--reviewer", "r", "--criteria", '["c"]', "--comment", "no"],
    ["handoff", "offer", "--dossier", "dossier-a", "--operation", "op", "--from-run", "run-a", "--to-actor", "b"],
    ["handoff", "accept", "--dossier", "dossier-a", "--operation", "op", "--handoff", "h", "--offered-content-digest", digest, "--actor", "b"],
    ["guard", "recover", "--dossier", "dossier-a", "--operation", "op"],
  ];
  const expected = ["init", "dossier.create", "dossier.show", "dossier.check", "evidence.add", "submission.create", "decision.accept", "decision.reject", "handoff.offer", "handoff.accept", "guard.recover"];
  for (let index = 0; index < commands.length; index += 1) {
    const calls: Array<{ command: string; request: unknown }> = [];
    const result = await runCli(commands[index]!, dependencies(calls));
    assert.equal(result.command, expected[index]);
    assert.equal(calls.at(-1)?.command, expected[index]);
  }
});

test("human mutations bind the displayed basis without rebinding", async () => {
  const calls: Array<{ command: string; request: unknown }> = [];
  const deps = dependencies(calls);
  const result = await runCli(["submission", "create", "--dossier", "dossier-a", "--operation", "op", "--run", "run-a"], deps);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.at(-1)?.request, { dossier_id: "dossier-a", operation_id: "op", submitting_run_id: "run-a", expected_revision: "4", expected_state_digest: digest });
  assert.equal((deps.terminal as Terminal).basis.length, 1);
});

test("guard recovery forwards the exact machine operation and basis with specialized confirmation", async () => {
  const calls: Array<{ command: string; request: unknown }> = [];
  const deps = dependencies(calls);
  const result = await runCli(["--json", "guard", "recover", "--dossier=dossier-a", "--operation=op-recover", "--expected-revision=4", `--expected-state-digest=${digest}`], deps);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.at(-1)?.request, { dossier_id: "dossier-a", operation_id: "op-recover", expected_revision: "4", expected_state_digest: digest, confirmation: deps.terminal });
});

test("human recovery never rebinds after an intervening basis change", async () => {
  const calls: Array<{ command: string; request: unknown }> = [];
  const deps = dependencies(calls);
  let currentRevision = "4";
  const terminal: CliTerminal = {
    interactive: true,
    confirmBasis: async () => { currentRevision = "5"; return true; },
    confirmDecision: async () => true,
    confirmRecovery: async () => true,
  };
  const recoverGuard = async (request: unknown): Promise<ResultEnvelope<unknown>> => {
    calls.push({ command: "guard.recover", request });
    const expected = (request as { expected_revision: string }).expected_revision;
    return expected === currentRevision ? success("guard.recover", "recovered", {}) : failure("guard.recover", "CASE_E_CONFLICT", "stale recovery basis");
  };
  const result = await runCli(["guard", "recover", "--dossier", "dossier-a", "--operation", "op-recover"], { ...deps, terminal, workflows: { ...deps.workflows, recoverGuard } });
  assert.equal(result.code, "CASE_E_CONFLICT");
  assert.equal((calls.at(-1)?.request as { expected_revision: string }).expected_revision, "4");
});

test("exit mapping is exhaustive", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(EXIT_BY_CODE)), {
    CASE_OK: 0, CASE_E_USAGE: 2, CASE_E_NOT_INITIALIZED: 10, CASE_E_NAMESPACE_COLLISION: 10,
    CASE_E_UNSUPPORTED_VERSION: 10, CASE_E_UNSUPPORTED_PROFILE: 10, CASE_E_PARSE: 20, CASE_E_SCHEMA: 20, CASE_E_INVARIANT: 20,
    CASE_E_EVIDENCE: 20, CASE_E_CONFLICT: 30, CASE_E_BUSY: 30, CASE_E_RECOVERY_REQUIRED: 30,
    CASE_E_TRANSITION: 40, CASE_E_ACTOR: 40, CASE_E_HUMAN_CONFIRMATION: 40, CASE_E_INTERNAL: 70,
  });
});

test("real process JSON usage is one newline-terminated envelope with empty stderr", () => {
  const run = spawnSync(process.execPath, ["dist/src/cli/main.js", "--json", "dossier", "show"], { encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.equal(run.stderr, "");
  assert.equal(run.stdout.endsWith("\n"), true);
  assert.equal(run.stdout.trim().split(/\r?\n/u).length, 1);
  assert.equal(JSON.parse(run.stdout).code, "CASE_E_USAGE");
});

test("production Windows initialization fails closed", { skip: process.platform !== "win32" }, () => {
  const run = spawnSync(process.execPath, ["dist/src/cli/main.js", "--json", "init", "--operation", "op"], { encoding: "utf8" });
  assert.equal(run.status, 10);
  assert.equal(run.stderr, "");
  assert.equal(run.stdout.endsWith("\n"), true);
  assert.equal(run.stdout.trim().split(/\r?\n/u).length, 1);
  assert.equal(JSON.parse(run.stdout).code, "CASE_E_UNSUPPORTED_PROFILE");
});

test("human rendering exposes bounded next-command material from views and snapshot results", () => {
  const writes: string[] = [];
  renderHuman(success("dossier.show", "Current dossier", basis), { write: (value) => { writes.push(value); } });
  assert.match(writes.join(""), /active writer: actor-a/);
  assert.match(writes.join(""), /active run: run-a/);
  assert.match(writes.join(""), /state digest: sha256:aaaaaaaaaaaa…/);
  assert.match(writes.join(""), /next: CASE_NEXT_CREATE_SUBMISSION/);
  writes.length = 0;
  renderHuman(success("evidence.add", "added", { snapshot: { ...basis, current_submission_id: "submission-a" }, evidence: { evidence_id: "evidence-a", artifact_digest: digest } }), { write: (value) => { writes.push(value); } });
  assert.match(writes.join(""), /evidence ID: evidence-a/);
  assert.match(writes.join(""), /artifact digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(writes.join(""), /submission ID: submission-a/);
  assert.doesNotMatch(writes.join(""), /"evidence":\[/);
});

test("TTY adapter refuses decisions when the terminal is unavailable or the phrase is wrong", async () => {
  const terminal = new TtyTerminal();
  assert.equal(terminal.interactive, false);
  assert.equal(await terminal.confirmDecision({} as never, "WRONG PHRASE"), false);
  assert.equal(await terminal.confirmDecision({} as never, DECISION_CONFIRMATION_PHRASE), false);
});

test("specialized confirmation formatters expose complete governed review and recovery material", () => {
  const review = {
    submission: { submission_id: "submission-a", submission_digest: digest },
    acceptance_criteria: [{ criterion_id: "c", statement: "check it", verification: "mechanical" }],
    decision_envelope: { decision_id: "decision-a", decision: "accepted", reviewer_id: "reviewer-a", comment: "reviewed", submission_digest: digest },
    identity_limitation: "Recorded interactive claim; not authentication or non-repudiation.",
  } as never;
  const decisionText = decisionConfirmationText(review);
  for (const material of ["submission-a", "criterion_id", "decision-a", "accepted", "reviewer-a", "reviewed", "not authentication"]) assert.match(decisionText, new RegExp(material));
  const recoveryText = recoveryConfirmationText({ dossier_id: "dossier-a", guard_id: "guard-a", created_at: "2026-09-04T00:00:00Z", process_identity: { profile: "test", pid: "7", process_started_at: "2026-09-03T00:00:00Z" } });
  for (const material of ["dossier-a", "guard-a", "created_at", "test", '"7"', "process_started_at"]) assert.match(recoveryText, new RegExp(material));
  assert.equal(exactConfirmation(DECISION_CONFIRMATION_PHRASE, DECISION_CONFIRMATION_PHRASE), true);
  assert.equal(exactConfirmation(`${DECISION_CONFIRMATION_PHRASE} `, DECISION_CONFIRMATION_PHRASE), false);
});

test("confirmation prompts render the exact basis, decision review, and recovery view", () => {
  const smallView = {
    dossier_id: "dossier-a",
    title: "Title",
    objective: "Objective",
    scope: null,
    constraints: null,
    active_run: { run_id: "run-a", actor_id: "actor-a", started_by_handoff_id: null },
    state_revision: "4",
    state_digest: digest,
    criterion_results: [],
    evidence_gaps: [],
    current_checks: "passed",
    review: "working",
    acceptance: "pending",
    handoff: "none",
    recommended_next_action: "CASE_NEXT_CREATE_SUBMISSION",
    unresolved_warnings: [],
  } as unknown as CurrentView;
  assert.equal(
    basisConfirmationPrompt(smallView, { command: "submission.create", operation_id: "op-submit" }),
    `Current view: {"dossier_id":"dossier-a","title":"Title","objective":"Objective","scope":null,"constraints":null,"active_run":{"run_id":"run-a","actor_id":"actor-a","started_by_handoff_id":null},"state_revision":"4","state_digest":"${digest}","criterion_results":[],"evidence_gaps":[],"current_checks":"passed","review":"working","acceptance":"pending","handoff":"none","recommended_next_action":"CASE_NEXT_CREATE_SUBMISSION","unresolved_warnings":[]}\nProposed transition: {"command":"submission.create","operation_id":"op-submit"}\nConfirm this exact basis.\nType exactly: CONFIRM THIS BASIS\n> `,
  );
  const review = {
    submission: { submission_id: "submission-a", submission_digest: digest },
    acceptance_criteria: [{ criterion_id: "criterion-a", statement: "Inspect", verification: "mechanical" }],
    decision_envelope: { decision_id: "decision-a", decision: "accepted", reviewer_id: "reviewer-a", comment: "Reviewed", submission_digest: digest },
    identity_limitation: "Recorded interactive claim; not authentication or non-repudiation.",
  } as never;
  assert.equal(
    decisionConfirmationPrompt(review, DECISION_CONFIRMATION_PHRASE),
    `Submission: {"submission_id":"submission-a","submission_digest":"${digest}"}\nAcceptance criteria: [{"criterion_id":"criterion-a","statement":"Inspect","verification":"mechanical"}]\nDecision: {"decision_id":"decision-a","decision":"accepted","reviewer_id":"reviewer-a","comment":"Reviewed","submission_digest":"${digest}"}\nIdentity limitation: Recorded interactive claim; not authentication or non-repudiation.\nRecord this exact human decision.\nType exactly: RECORD THIS HUMAN DECISION\n> `,
  );
  assert.equal(
    recoveryConfirmationPrompt({ dossier_id: "dossier-a", guard_id: "guard-a", created_at: "2026-09-04T00:00:00Z", process_identity: { profile: "test", pid: "7", process_started_at: "2026-09-03T00:00:00Z" } }),
    "Recovery guard: {\"dossier_id\":\"dossier-a\",\"guard_id\":\"guard-a\",\"created_at\":\"2026-09-04T00:00:00Z\",\"process_identity\":{\"profile\":\"test\",\"pid\":\"7\",\"process_started_at\":\"2026-09-03T00:00:00Z\"}}\nRecover this writer guard.\nType exactly: RECOVER THIS WRITER GUARD\n> ",
  );
});

test("injected runner completes init through acceptance and derives stale after artifact change", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "case-agent-cli-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  assert.equal(spawnSync("git", ["init", "--quiet", root]).status, 0);
  const schemas = await SchemaRegistry.load(join(process.cwd(), "schemas"));
  const initFs = { ...nodeRepositoryFileSystem, classifyInitializationTarget: async () => ({ supported: true as const, profile: "test-local" }) };
  const terminal = new Terminal();
  let runNumber = 0;
  const fs = controlledAtomicFs(root);
  const store = new CaseStore(root, schemas);
  const dossiers: DossierDirectoryPublicationPort = {
    profile: fs.profile,
    async publishCreateOnce(relativeDirectory, contents) {
      const target = resolve(root, relativeDirectory); const staging = `${target}.staging`;
      await mkdir(staging);
      for (const directory of contents.directories) await mkdir(join(staging, directory));
      for (const [relativePath, bytes] of Object.entries(contents.files)) {
        const path = join(staging, relativePath); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes, { flag: "wx" });
      }
      await rename(staging, target);
    },
  };
  const ports: WorkflowPorts = {
    repository_root: root, store, schemas, evidenceFs: nodePathInspection, fs, dossiers,
    processIdentity: { current: async () => ({ profile: "test", pid: "1", process_started_at: "2026-09-04T03:02:01Z" }), verifyTerminated: async () => "terminated" },
    clock: { now: () => "2026-09-04T03:02:01Z", isPossiblyStale: () => false },
    ids: {
      createGuardId: () => "guard-a", tempIdFor: () => "temp-a", envelopeIdFor: (kind, operation) => `${kind}-${operation}`,
      createDossierId: () => "dossier-a", createRunId: () => `run-${String.fromCharCode(97 + runNumber++)}`, evidenceIdFor: (operation) => `evidence-${operation}`,
    },
  };
  const deps: CliDependencies = { cwd: root, terminal, workflows: {
    init: (request) => initRepository(request, { fs: initFs, schemas, createRepositoryId: () => "repository-a", now: () => "2026-09-04T03:02:01Z", displayRepositoryRoot: () => undefined }),
    createDossier: (request) => createDossier(request, ports), showDossier: (request) => showDossier(request, ports), checkDossier: (request) => checkDossier(request, ports),
    addEvidence: (request) => addEvidence(request, ports), createSubmission: (request) => createSubmission(request, ports), recordDecision: (request) => recordDecision(request, { ...ports, confirmation: terminal }),
    offerHandoff: (request) => offerHandoff(request, ports), acceptHandoff: (request) => acceptHandoff(request, ports), recoverGuard: (request) => recoverWriterGuard(store, request, ports),
  } };
  assert.equal((await runCli(["init", "--operation", "op-init"], deps)).ok, true);
  const brief = '{"scope":{"in":["artifact.txt"],"out":[]},"constraints":["local-only"],"acceptance_criteria":[{"criterion_id":"c","statement":"artifact current","verification":"mechanical"}]}';
  assert.equal((await runCli(["dossier", "create", "--operation", "op-create", "--actor", "actor-a", "--title", "T", "--objective", "O", "--brief", brief], deps)).ok, true);
  await writeFile(join(root, "artifact.txt"), "v1");
  const evidence = '{"kind":"file","criterion_ids":["c"],"freshness":"recompute_on_check","limitations":[],"location":{"repository_relative_path":"artifact.txt"}}';
  assert.equal((await runCli(["evidence", "add", "--dossier", "dossier-a", "--operation", "op-evidence", "--run", "run-a", "--evidence", evidence], deps)).ok, true);
  const offered = await runCli(["handoff", "offer", "--dossier", "dossier-a", "--operation", "op-offer", "--from-run", "run-a", "--to-actor", "actor-b"], deps);
  assert.equal(offered.ok, true); if (!offered.ok) return;
  const offer = offered.data as { handoff_id: string; offered_content_digest: string };
  assert.equal((await runCli(["handoff", "accept", "--dossier", "dossier-a", "--operation", "op-accept", "--handoff", offer.handoff_id, "--offered-content-digest", offer.offered_content_digest, "--actor", "actor-b"], deps)).ok, true);
  const submitted = await runCli(["submission", "create", "--dossier", "dossier-a", "--operation", "op-submit", "--run", "run-b"], deps);
  assert.equal(submitted.ok, true); if (!submitted.ok) return;
  const submission = submitted.data as { submission_id: string; submission_digest: string };
  assert.equal((await runCli(["decision", "accept", "--dossier", "dossier-a", "--operation", "op-decision", "--submission", submission.submission_id, "--submission-digest", submission.submission_digest, "--reviewer", "reviewer", "--criteria", '["c"]', "--comment", "accepted"], deps)).ok, true);
  await writeFile(join(root, "artifact.txt"), "v2");
  const shown = await runCli(["dossier", "show", "--dossier", "dossier-a"], deps);
  assert.equal(shown.ok, true); if (shown.ok) assert.equal((shown.data as CurrentView).acceptance, "stale");
});
