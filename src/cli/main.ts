#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stderr, stdout } from "node:process";
import { DECISION_CONFIRMATION_PHRASE, type ConfirmationPort, type ExactSubmissionReview, type ProposedTransition } from "./confirm.js";
import { parseCliRequest, type CliRequest } from "./args.js";
import { renderHuman, renderJson } from "./render.js";
import { exitCodeFor } from "../protocol/errors.js";
import { failure, success, type ResultEnvelope } from "../protocol/result.js";
import { SchemaRegistry } from "../protocol/schema-registry.js";
import type { CurrentView, MutationPrecondition } from "../protocol/types.js";
import { nodeAtomicFsPort } from "../storage/atomic.js";
import { CaseStore } from "../storage/store.js";
import { recoverWriterGuard, type RecoverWriterGuardRequest, type RecoveryConfirmationPort, type RecoveryConfirmationView } from "../storage/guard.js";
import { createDossier, showDossier, type CreateDossierRequest, type DossierDirectoryPublicationPort, type WorkflowPorts } from "../workflows/dossier.js";
import { addEvidence, checkDossier, type AddEvidenceRequest } from "../workflows/evidence.js";
import { acceptHandoff, offerHandoff, type AcceptHandoffRequest, type OfferHandoffRequest } from "../workflows/handoff.js";
import { createSubmission, type CreateSubmissionRequest } from "../workflows/submission.js";
import { recordDecision, type DecisionRequest } from "../workflows/decision.js";
import { initRepository, nodeRepositoryFileSystem, type InitRequest } from "../workflows/init.js";

export interface CliTerminal extends ConfirmationPort, RecoveryConfirmationPort {}
export function exactConfirmation(input: string, phrase: string): boolean { return input === phrase; }
export function decisionConfirmationText(review: ExactSubmissionReview): string {
  return [
    `Submission: ${JSON.stringify(review.submission)}`,
    `Acceptance criteria: ${JSON.stringify(review.acceptance_criteria)}`,
    `Decision: ${JSON.stringify(review.decision_envelope)}`,
    `Identity limitation: ${review.identity_limitation}`,
  ].join("\n");
}
export function recoveryConfirmationText(view: RecoveryConfirmationView): string {
  return `Recovery guard: ${JSON.stringify(view)}`;
}
function exactPrompt(display: string, question: string, phrase: string): string {
  return `${display}\n${question}\nType exactly: ${phrase}\n> `;
}
export function basisConfirmationPrompt(view: CurrentView, proposed: ProposedTransition): string {
  return exactPrompt(
    `Current view: ${JSON.stringify(view)}\nProposed transition: ${JSON.stringify(proposed)}`,
    "Confirm this exact basis.",
    "CONFIRM THIS BASIS",
  );
}
export function decisionConfirmationPrompt(review: ExactSubmissionReview, phrase: string): string {
  return exactPrompt(decisionConfirmationText(review), "Record this exact human decision.", phrase);
}
export function recoveryConfirmationPrompt(view: RecoveryConfirmationView): string {
  return exactPrompt(recoveryConfirmationText(view), "Recover this writer guard.", "RECOVER THIS WRITER GUARD");
}
type Workflow<T> = (request: T, terminal?: CliTerminal) => Promise<ResultEnvelope<unknown>>;
export interface CliWorkflowDependencies {
  readonly init: Workflow<InitRequest>; readonly createDossier: Workflow<CreateDossierRequest>;
  readonly showDossier: Workflow<{ dossier_id: string }>; readonly checkDossier: Workflow<{ dossier_id: string }>;
  readonly addEvidence: Workflow<AddEvidenceRequest>; readonly createSubmission: Workflow<CreateSubmissionRequest & MutationPrecondition>;
  readonly recordDecision: Workflow<DecisionRequest & MutationPrecondition>; readonly offerHandoff: Workflow<OfferHandoffRequest & MutationPrecondition>;
  readonly acceptHandoff: Workflow<AcceptHandoffRequest & MutationPrecondition>; readonly recoverGuard: Workflow<RecoverWriterGuardRequest>;
}
export interface CliDependencies { readonly cwd: string; readonly terminal: CliTerminal; readonly workflows: CliWorkflowDependencies }

function publicCommand(result: ResultEnvelope<unknown>, command: string): ResultEnvelope<unknown> {
  return result.command === command ? result : { ...result, command };
}

async function completeBasis(request: Extract<CliRequest, { basis: unknown }>, dependencies: CliDependencies): Promise<ResultEnvelope<Pick<MutationPrecondition, "expected_revision" | "expected_state_digest">>> {
  if (request.basis !== null) return success(request.command, "Explicit mutation basis", request.basis);
  const shown = await dependencies.workflows.showDossier({ dossier_id: request.dossier_id });
  if (!shown.ok) return { ...shown, command: request.command };
  const view = shown.data as CurrentView;
  let confirmed = false;
  try { confirmed = dependencies.terminal.interactive && await dependencies.terminal.confirmBasis(view, { command: request.command, operation_id: request.operation_id }); }
  catch { confirmed = false; }
  if (!confirmed) return failure(request.command, "CASE_E_HUMAN_CONFIRMATION", "Interactive basis confirmation was not recorded");
  return success(request.command, "Confirmed mutation basis", { expected_revision: view.state_revision, expected_state_digest: view.state_digest });
}

export async function runCli(argv: readonly string[], dependencies: CliDependencies): Promise<ResultEnvelope<unknown>> {
  const parsed = parseCliRequest(argv, dependencies.cwd);
  if (!parsed.ok) return parsed;
  const request = parsed.data;
  try {
    if (request.command === "version") return success("version", "case-agent 0.1.0-preview", { version: "0.1.0-preview" });
    if (request.command === "init") return publicCommand(await dependencies.workflows.init({ start_directory: request.start_directory, operation_id: request.operation_id }), request.command);
    if (request.command === "dossier.create") { const { command, json: _json, ...body } = request; return publicCommand(await dependencies.workflows.createDossier(body), command); }
    if (request.command === "dossier.show") return publicCommand(await dependencies.workflows.showDossier({ dossier_id: request.dossier_id }), request.command);
    if (request.command === "dossier.check") return publicCommand(await dependencies.workflows.checkDossier({ dossier_id: request.dossier_id }), request.command);
    const completed = await completeBasis(request, dependencies);
    if (!completed.ok) return completed;
    const common: MutationPrecondition = { dossier_id: request.dossier_id, operation_id: request.operation_id, ...completed.data };
    if (request.command === "guard.recover") return publicCommand(await dependencies.workflows.recoverGuard({ ...common, confirmation: dependencies.terminal }, dependencies.terminal), request.command);
    if (request.command === "evidence.add") {
      return publicCommand(await dependencies.workflows.addEvidence({ ...common, run_id: request.run_id, ...request.evidence }), request.command);
    }
    if (request.command === "submission.create") return publicCommand(await dependencies.workflows.createSubmission({ ...common, submitting_run_id: request.submitting_run_id }), request.command);
    if (request.command === "decision.accept" || request.command === "decision.reject") return publicCommand(await dependencies.workflows.recordDecision({ ...common, submission_id: request.submission_id, submission_digest: request.submission_digest, reviewer_id: request.reviewer_id, criteria_reviewed: request.criteria_reviewed, comment: request.comment, decision: request.command === "decision.accept" ? "accepted" : "rejected" }, dependencies.terminal), request.command);
    if (request.command === "handoff.offer") return publicCommand(await dependencies.workflows.offerHandoff({ ...common, from_run_id: request.from_run_id, to_actor_id: request.to_actor_id }), request.command);
    return publicCommand(await dependencies.workflows.acceptHandoff({ ...common, handoff_id: request.handoff_id, offered_content_digest: request.offered_content_digest, actor_id: request.actor_id }), request.command);
  } catch { return failure(request.command, "CASE_E_INTERNAL", "The command failed unexpectedly"); }
}

export class TtyTerminal implements CliTerminal {
  readonly interactive = Boolean(stdin.isTTY && stderr.isTTY);
  private async exact(prompt: string, phrase: string): Promise<boolean> {
    if (!this.interactive) return false;
    const reader = createInterface({ input: stdin, output: stderr });
    try { return exactConfirmation(await reader.question(prompt), phrase); } finally { reader.close(); }
  }
  async confirmBasis(view: CurrentView, proposed: ProposedTransition): Promise<boolean> {
    if (!this.interactive) return false;
    return this.exact(basisConfirmationPrompt(view, proposed), "CONFIRM THIS BASIS");
  }
  async confirmDecision(review: ExactSubmissionReview, phrase: string): Promise<boolean> {
    if (!this.interactive || phrase !== DECISION_CONFIRMATION_PHRASE) return false;
    return this.exact(decisionConfirmationPrompt(review, phrase), DECISION_CONFIRMATION_PHRASE);
  }
  async confirmRecovery(view: RecoveryConfirmationView): Promise<boolean> {
    if (!this.interactive) return false;
    return this.exact(recoveryConfirmationPrompt(view), "RECOVER THIS WRITER GUARD");
  }
}

async function productionDependencies(cwd: string): Promise<CliDependencies> {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const schemas = await SchemaRegistry.load(join(packageRoot, "schemas"));
  const fs = nodeAtomicFsPort(cwd);
  const store = new CaseStore(cwd, schemas);
  const dossiers: DossierDirectoryPublicationPort = { profile: fs.profile, async publishCreateOnce() { throw new Error("Unsupported production dossier publication profile"); } };
  const terminal = new TtyTerminal();
  const ports: WorkflowPorts = {
    repository_root: cwd, store, schemas, fs, dossiers,
    processIdentity: { current: async () => ({ profile: `node-${process.platform}`, pid: String(process.pid), process_started_at: new Date(Date.now() - process.uptime() * 1000).toISOString() }), verifyTerminated: async () => "unknown" },
    clock: { now: () => new Date().toISOString(), isPossiblyStale: () => true },
    ids: { createGuardId: randomUUID, tempIdFor: (id) => `temp-${id}`, envelopeIdFor: (kind, operation) => `${kind}-${operation}`, createDossierId: () => `dossier-${randomUUID()}`, createRunId: () => `run-${randomUUID()}`, evidenceIdFor: (operation) => `evidence-${operation}` },
  };
  return { cwd, terminal, workflows: {
    init: (request) => initRepository(request, { fs: nodeRepositoryFileSystem, schemas, createRepositoryId: () => `repository-${randomUUID()}`, now: () => new Date().toISOString(), displayRepositoryRoot: () => undefined }),
    createDossier: (request) => createDossier(request, ports), showDossier: (request) => showDossier(request, ports), checkDossier: (request) => checkDossier(request, ports),
    addEvidence: (request) => addEvidence(request, ports), createSubmission: (request) => createSubmission(request, ports), recordDecision: (request) => recordDecision(request, { ...ports, confirmation: terminal }),
    offerHandoff: (request) => offerHandoff(request, ports), acceptHandoff: (request) => acceptHandoff(request, ports), recoverGuard: (request) => recoverWriterGuard(store, request, ports),
  } };
}

async function executable(): Promise<void> {
  const json = process.argv.slice(2).includes("--json");
  let result: ResultEnvelope<unknown>;
  try { result = await runCli(process.argv.slice(2), await productionDependencies(process.cwd())); } catch { result = failure("cli", "CASE_E_INTERNAL", "The CLI could not start safely"); }
  if (json) renderJson(result, stdout); else renderHuman(result, stdout);
  process.exitCode = exitCodeFor(result.code);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await executable();
