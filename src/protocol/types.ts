declare const digestBrand: unique symbol;
declare const decimalStringBrand: unique symbol;
declare const revisionBrand: unique symbol;

/** A lowercase SHA-256 digest in the protocol wire format. */
export type Digest = string & { readonly [digestBrand]: "Digest" };

/** A non-negative base-10 integer encoded as a string. */
export type DecimalString = string & { readonly [decimalStringBrand]: "DecimalString" };

/** A monotonically increasing protocol revision encoded as a decimal string. */
export type Revision = string & { readonly [revisionBrand]: "Revision" };

export const DECIMAL_STRING_PATTERN = /^(0|[1-9][0-9]*)$/;
export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export function isDecimalString(value: unknown): value is DecimalString {
  return typeof value === "string" && DECIMAL_STRING_PATTERN.test(value);
}

export function decimalString(value: string): DecimalString {
  if (!isDecimalString(value)) {
    throw new TypeError(`Invalid decimal string: ${value}`);
  }
  return value;
}

export function isRevision(value: unknown): value is Revision {
  return isDecimalString(value);
}

export function revision(value: string): Revision {
  if (!isRevision(value)) {
    throw new TypeError(`Invalid revision: ${value}`);
  }
  return value;
}

export function isDigest(value: unknown): value is Digest {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

export function digest(value: string): Digest {
  if (!isDigest(value)) {
    throw new TypeError(`Invalid digest: ${value}`);
  }
  return value;
}

export type CriterionVerification = "mechanical" | "recorded_human_review";
export type EvidenceKind = "file" | "command_result" | "external_reference" | "human_observation";

export interface ActiveRun {
  run_id: string;
  actor_id: string;
  started_by_handoff_id: string | null;
}

export interface MutationPrecondition {
  dossier_id: string;
  expected_revision: Revision;
  expected_state_digest: Digest;
  operation_id: string;
}

export type Freshness = "immutable" | "recompute_on_check" | "human_review";
export type EvidenceStatus = "current" | "missing" | "empty" | "changed" | "unsafe" | "human_review_required";
export type CriterionStatus = "mechanically_satisfied" | "human_review_required" | "failed";

export interface Manifest {
  protocol: "case-agent";
  protocol_version: "0.1.0-preview";
  schema_dialect: "https://json-schema.org/draft/2020-12/schema";
  repository_id: string;
  created_at: string;
}

export interface AcceptanceCriterion {
  criterion_id: string;
  statement: string;
  verification: CriterionVerification;
}

export type EvidenceRecord = {
  evidence_id: string;
  criterion_ids: string[];
  captured_at: string;
  freshness: Freshness;
  limitations: string[];
} & (
  | {
      kind: "file" | "command_result";
      location: { repository_relative_path: string };
      artifact_digest: Digest;
      artifact_size: DecimalString;
    }
  | {
      kind: "external_reference";
      location: { uri: string };
      artifact_digest?: never;
      artifact_size?: never;
    }
  | {
      kind: "human_observation";
      location: { statement: string };
      artifact_digest?: never;
      artifact_size?: never;
    }
);

export interface LastOperation {
  operation_id: string;
  input_digest: Digest;
  basis_revision: Revision;
  resulting_revision: Revision;
}

export interface DossierSnapshot {
  dossier_id: string;
  title: string;
  objective: string;
  scope: { in: string[]; out: string[] };
  constraints: string[];
  acceptance_criteria: AcceptanceCriterion[];
  state_revision: Revision;
  state_digest: Digest;
  last_operation: LastOperation | null;
  active_run: ActiveRun;
  evidence: EvidenceRecord[];
  current_handoff_id: string | null;
  current_submission_id: string | null;
  current_decision_id: string | null;
}

export interface HandoffEnvelope {
  handoff_id: string;
  dossier_id: string;
  from_run_id: string;
  to_actor_id: string;
  basis_revision: Revision;
  basis_state_digest: Digest;
  published_revision: Revision;
  offered_content_digest: Digest;
  created_operation_id: string;
}

export interface SubmissionEnvelope {
  submission_id: string;
  dossier_id: string;
  submitting_run_id: string;
  basis_revision: Revision;
  basis_state_digest: Digest;
  published_revision: Revision;
  content_digest: Digest;
  observed_evidence_digest: Digest;
  checks_digest: Digest;
  created_at: string;
  created_operation_id: string;
  submission_digest: Digest;
}

export interface DecisionEnvelope {
  decision_id: string;
  dossier_id: string;
  submission_id: string;
  submission_digest: Digest;
  decision: "accepted" | "rejected";
  reviewer_id: string;
  criteria_reviewed: string[];
  comment: string;
  decided_at: string;
  created_operation_id: string;
  identity_assurance: "recorded-interactive-claim";
}

export interface ObservedEvidenceResult {
  evidence_id: string;
  status: EvidenceStatus;
  observed_artifact_digest: Digest | null;
  observed_artifact_size: DecimalString | null;
  stable_limitation_codes: string[];
}

export interface ObservedEvidenceProjection {
  dossier_id: string;
  content_digest: Digest;
  evidence_results: ObservedEvidenceResult[];
}

export interface InvariantResult {
  code: string;
  status: "passed" | "failed";
}

export interface CriterionResult {
  criterion_id: string;
  status: CriterionStatus;
  supporting_evidence_ids: string[];
}

export interface ChecksProjection {
  dossier_id: string;
  content_digest: Digest;
  observed_evidence_digest: Digest;
  invariant_results: InvariantResult[];
  criterion_results: CriterionResult[];
  stable_warning_codes: string[];
  verdict: "passed" | "failed";
}

export type CurrentChecksStatus = "passed" | "failed";
export type ReviewStatus = "working" | "ready_for_review" | "changes_requested";
export type AcceptanceStatus = "pending" | "accepted" | "rejected" | "stale";
export type HandoffStatus = "none" | "offered" | "accepted" | "stale";

export interface CurrentCriterionView {
  criterion_id: string;
  status: CriterionStatus;
  supporting_evidence_ids: string[];
}

/** The complete structured `dossier show --json` view. */
export interface CurrentView {
  dossier_id: string;
  title: string;
  objective: string;
  scope: DossierSnapshot["scope"] | null;
  constraints: string[] | null;
  active_run: ActiveRun;
  state_revision: Revision;
  state_digest: Digest;
  criterion_results: CurrentCriterionView[];
  evidence_gaps: string[];
  current_checks: CurrentChecksStatus;
  review: ReviewStatus;
  acceptance: AcceptanceStatus;
  handoff: HandoffStatus;
  recommended_next_action: string;
  unresolved_warnings: string[];
}
