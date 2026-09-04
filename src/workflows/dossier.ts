import { digestProjection } from "../protocol/canonical.js";
import { parseGovernedJson } from "../protocol/json.js";
import { projectChecks, projectState } from "../protocol/projections.js";
import { failure, success, type ResultEnvelope } from "../protocol/result.js";
import type { SchemaRegistry } from "../protocol/schema-registry.js";
import {
  revision,
  type AcceptanceCriterion,
  type ChecksProjection,
  type CurrentView,
  type DossierSnapshot,
} from "../protocol/types.js";
import type { AtomicFsPort, AtomicPublicationProfile } from "../storage/atomic.js";
import type { IdPort, MutationPorts } from "../storage/guard.js";
import type { PathInspectionPort } from "../storage/paths.js";
import type { CaseStore } from "../storage/store.js";

export interface CreateDossierRequest {
  operation_id: string;
  actor_id: string;
  title: string;
  objective: string;
  scope: { in: string[]; out: string[] };
  constraints: string[];
  acceptance_criteria: AcceptanceCriterion[];
}

export interface CreateDossierResult {
  snapshot: DossierSnapshot;
}

export interface DossierDirectoryPublicationPort {
  readonly profile: AtomicPublicationProfile;
  /** Publish a fully populated directory at an absent repository-relative path. */
  publishCreateOnce(relativeDirectory: string, contents: {
    readonly directories: readonly string[];
    readonly files: Readonly<Record<string, Uint8Array>>;
  }): Promise<void>;
}

export interface WorkflowIdPort extends IdPort {
  createDossierId(): string;
  createRunId(): string;
  evidenceIdFor(operationId: string): string;
}

export interface ReadPorts {
  readonly repository_root: string;
  readonly store: CaseStore;
  readonly schemas: Pick<SchemaRegistry, "validate">;
  readonly fs: AtomicFsPort;
  readonly evidenceFs?: PathInspectionPort;
}

export interface WorkflowPorts extends ReadPorts, Omit<MutationPorts, "ids" | "schemas" | "fs"> {
  readonly fs: AtomicFsPort;
  readonly schemas: Pick<SchemaRegistry, "validate">;
  readonly ids: WorkflowIdPort;
  readonly dossiers: DossierDirectoryPublicationPort;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

export function isSafeOpaqueId(value: unknown): value is string {
  return typeof value === "string"
    && /^[A-Za-z0-9._-]+$/u.test(value)
    && value !== "."
    && value !== "..";
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function textArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyText);
}

function validCriterion(value: unknown): value is AcceptanceCriterion {
  if (!isRecord(value) || !hasExactKeys(value, ["criterion_id", "statement", "verification"])) return false;
  return isSafeOpaqueId(value.criterion_id)
    && nonEmptyText(value.statement)
    && (value.verification === "mechanical" || value.verification === "recorded_human_review");
}

function validCreateRequest(value: unknown): value is CreateDossierRequest {
  if (!isRecord(value) || !hasExactKeys(value, [
    "acceptance_criteria",
    "actor_id",
    "constraints",
    "objective",
    "operation_id",
    "scope",
    "title",
  ])) return false;
  if (!nonEmptyText(value.operation_id) || !nonEmptyText(value.actor_id)
    || !nonEmptyText(value.title) || !nonEmptyText(value.objective)
    || !textArray(value.constraints) || !isRecord(value.scope)
    || !hasExactKeys(value.scope, ["in", "out"])
    || !textArray(value.scope.in) || !textArray(value.scope.out)
    || !Array.isArray(value.acceptance_criteria) || value.acceptance_criteria.length === 0
    || !value.acceptance_criteria.every(validCriterion)) return false;
  const ids = value.acceptance_criteria.map((criterion) => criterion.criterion_id);
  return new Set(ids).size === ids.length;
}

function isExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

/** Create one immutable M0 brief and its initial active run. */
export async function createDossier(
  request: CreateDossierRequest,
  ports: WorkflowPorts,
): Promise<ResultEnvelope<CreateDossierResult>> {
  if (!validCreateRequest(request)) {
    return failure("dossier.create", "CASE_E_USAGE", "A complete valid dossier brief is required");
  }
  if (!ports.dossiers.profile.supported) {
    return failure("dossier.create", "CASE_E_UNSUPPORTED_PROFILE", "Complete dossier publication is unavailable for this filesystem profile");
  }

  let snapshot: DossierSnapshot;
  try {
    const dossierId = ports.ids.createDossierId();
    const runId = ports.ids.createRunId();
    if (!isSafeOpaqueId(dossierId) || !isSafeOpaqueId(runId)) {
      return failure("dossier.create", "CASE_E_INTERNAL", "Safe dossier identifiers could not be generated");
    }
    const candidate: DossierSnapshot = {
      dossier_id: dossierId,
      title: request.title,
      objective: request.objective,
      scope: { in: [...request.scope.in], out: [...request.scope.out] },
      constraints: [...request.constraints],
      acceptance_criteria: request.acceptance_criteria.map((criterion) => ({ ...criterion })),
      state_revision: revision("0"),
      state_digest: digestProjection({}),
      last_operation: null,
      active_run: { run_id: runId, actor_id: request.actor_id, started_by_handoff_id: null },
      evidence: [],
      current_handoff_id: null,
      current_submission_id: null,
      current_decision_id: null,
    };
    snapshot = { ...candidate, state_digest: digestProjection(projectState(candidate)) };
    if (!ports.schemas.validate("dossier", snapshot).ok) {
      return failure("dossier.create", "CASE_E_INTERNAL", "Generated dossier validation failed");
    }
    const bytes = Buffer.from(`${JSON.stringify(snapshot)}\n`, "utf8");
    const roundTrip = parseGovernedJson(bytes);
    if (!ports.schemas.validate("dossier", roundTrip).ok
      || digestProjection(projectState(roundTrip as unknown as DossierSnapshot)) !== snapshot.state_digest) {
      return failure("dossier.create", "CASE_E_INTERNAL", "Generated dossier round-trip validation failed");
    }
    await ports.dossiers.publishCreateOnce(`.case-agent/dossiers/${dossierId}`, {
      directories: ["handoffs", "submissions", "decisions"],
      files: { "dossier.json": bytes },
    });
  } catch (error) {
    return failure("dossier.create", isExists(error) ? "CASE_E_CONFLICT" : "CASE_E_INTERNAL",
      isExists(error) ? "The generated dossier address already exists" : "The dossier could not be published completely");
  }

  try {
    const persisted = await ports.store.loadDossier(snapshot.dossier_id);
    if (persisted.state_digest !== snapshot.state_digest
      || persisted.state_digest !== digestProjection(projectState(persisted))) {
      return failure("dossier.create", "CASE_E_RECOVERY_REQUIRED", "The published dossier could not be verified exactly");
    }
    return success("dossier.create", "Dossier created", { snapshot: persisted });
  } catch {
    return failure("dossier.create", "CASE_E_RECOVERY_REQUIRED", "The published dossier could not be reopened safely");
  }
}

function nextAction(
  checks: ChecksProjection,
  review: CurrentView["review"],
  acceptance: CurrentView["acceptance"],
  handoff: CurrentView["handoff"],
): string {
  const requiresInspection = checks.invariant_results.some(({ stage, status }) =>
    status === "failed" && stage !== "evidence_safety" && stage !== "evidence_integrity");
  if (requiresInspection) return "CASE_NEXT_INSPECT_STATE";
  if (handoff === "offered") return "CASE_NEXT_ACCEPT_HANDOFF";
  if (review === "changes_requested") return "CASE_NEXT_ADDRESS_CHANGES";
  if (checks.verdict === "failed") return "CASE_NEXT_ADD_EVIDENCE";
  if (acceptance === "accepted") return "CASE_NEXT_NONE";
  if (review === "ready_for_review") return "CASE_NEXT_REVIEW_SUBMISSION";
  return "CASE_NEXT_CREATE_SUBMISSION";
}

/** Recompute and return the bounded current view without trusting cached status. */
export async function showDossier(
  request: { dossier_id: string },
  ports: ReadPorts,
): Promise<ResultEnvelope<CurrentView>> {
  if (!isSafeOpaqueId(request.dossier_id)) {
    return failure("dossier.show", "CASE_E_USAGE", "An explicit valid dossier ID is required");
  }
  try {
    const snapshot = await ports.store.loadDossier(request.dossier_id);
    const { checkSnapshot } = await import("./evidence.js");
    const { checks, envelopes } = await checkSnapshot(snapshot, ports);
    const submissionCurrent = envelopes.submission !== null
      && envelopes.integrity
      && envelopes.submission.content_digest === checks.content_digest
      && envelopes.submission.observed_evidence_digest === checks.observed_evidence_digest
      && envelopes.submission.checks_digest === digestProjection(projectChecks(checks));
    const decision = submissionCurrent ? envelopes.decision : null;
    const review: CurrentView["review"] = submissionCurrent
      ? decision?.decision === "rejected" ? "changes_requested" : "ready_for_review"
      : "working";
    const acceptance: CurrentView["acceptance"] = snapshot.current_submission_id === null
      ? "pending"
      : !submissionCurrent
        ? "stale"
        : decision?.decision === "accepted"
          ? "accepted"
          : decision?.decision === "rejected"
            ? "rejected"
            : "pending";
    let handoff: CurrentView["handoff"] = "none";
    if (snapshot.current_handoff_id !== null) {
      const offer = envelopes.handoff;
      if (offer === null || !envelopes.integrity) handoff = "stale";
      else if (snapshot.active_run.started_by_handoff_id === offer.handoff_id
        && snapshot.active_run.actor_id === offer.to_actor_id) handoff = "accepted";
      else if (snapshot.state_revision === offer.published_revision
        && snapshot.active_run.run_id === offer.from_run_id
        && checks.content_digest === offer.offered_content_digest) handoff = "offered";
      else handoff = "stale";
    }
    const currentChecks: CurrentView["current_checks"] = checks.verdict;
    const warnings = [...new Set([
      ...checks.stable_warning_codes,
      ...(envelopes.integrity ? [] : ["CASE_W_ENVELOPE_INTEGRITY"]),
    ])].sort();
    const view: CurrentView = {
      dossier_id: snapshot.dossier_id,
      title: snapshot.title,
      objective: snapshot.objective,
      scope: null,
      constraints: null,
      active_run: { ...snapshot.active_run },
      state_revision: snapshot.state_revision,
      state_digest: snapshot.state_digest,
      criterion_results: checks.criterion_results.map((result) => ({ ...result })),
      evidence_gaps: checks.criterion_results
        .filter(({ status }) => status === "failed")
        .map(({ criterion_id }) => criterion_id),
      current_checks: currentChecks,
      review,
      acceptance,
      handoff,
      recommended_next_action: nextAction(checks, review, acceptance, handoff),
      unresolved_warnings: warnings,
    };
    return success("dossier.show", "Current dossier", view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("CASE_E_PARSE:")) {
      return failure("dossier.show", "CASE_E_PARSE", "The addressed dossier could not be parsed", "CASE_NEXT_INSPECT_STATE");
    }
    if (message.startsWith("CASE_E_SCHEMA:")) {
      return failure("dossier.show", "CASE_E_SCHEMA", "The addressed dossier does not match its schema", "CASE_NEXT_INSPECT_STATE");
    }
    if (message.startsWith("CASE_E_INVARIANT:")) {
      return failure("dossier.show", "CASE_E_INVARIANT", "The addressed dossier is unavailable or inconsistent", "CASE_NEXT_INSPECT_STATE");
    }
    return failure("dossier.show", "CASE_E_INTERNAL", "Current view derivation failed unexpectedly");
  }
}
