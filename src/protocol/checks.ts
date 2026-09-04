import { digestProjection } from "./canonical.js";
import { projectContent, projectObservedEvidence, projectState } from "./projections.js";
import type {
  ChecksProjection,
  CriterionResult,
  DossierSnapshot,
  EvidenceRecord,
  InvariantResult,
  ObservedEvidenceProjection,
} from "./types.js";

function stateMetadataIsValid(snapshot: DossierSnapshot): boolean {
  try {
    if (snapshot.state_digest !== digestProjection(projectState(snapshot))) return false;
    if (snapshot.last_operation === null) return snapshot.state_revision === "0";
    return snapshot.last_operation.resulting_revision === snapshot.state_revision
      && BigInt(snapshot.last_operation.basis_revision) + 1n === BigInt(snapshot.last_operation.resulting_revision);
  } catch {
    return false;
  }
}

function evidenceLinksAreValid(snapshot: DossierSnapshot): boolean {
  const criteria = new Set(snapshot.acceptance_criteria.map(({ criterion_id }) => criterion_id));
  const criterionIds = snapshot.acceptance_criteria.map(({ criterion_id }) => criterion_id);
  if (criteria.size !== criterionIds.length) return false;
  return snapshot.evidence.every((record) =>
    record.criterion_ids.length > 0
    && new Set(record.criterion_ids).size === record.criterion_ids.length
    && record.criterion_ids.every((criterionId) => criteria.has(criterionId)));
}

function observationsAreBound(snapshot: DossierSnapshot, observed: ObservedEvidenceProjection): boolean {
  if (observed.dossier_id !== snapshot.dossier_id
    || observed.content_digest !== digestProjection(projectContent(snapshot))
    || observed.evidence_results.length !== snapshot.evidence.length) return false;
  return observed.evidence_results.every((result, index) => result.evidence_id === snapshot.evidence[index]?.evidence_id);
}

function evidenceIntegrityIsValid(snapshot: DossierSnapshot, observed: ObservedEvidenceProjection): boolean {
  const evidenceIds = snapshot.evidence.map(({ evidence_id }) => evidence_id);
  if (new Set(evidenceIds).size !== evidenceIds.length || !observationsAreBound(snapshot, observed)) return false;
  return snapshot.evidence.every((record, index) => {
    const status = observed.evidence_results[index]?.status;
    return record.kind === "file" || record.kind === "command_result"
      ? status === "current"
      : status === "human_review_required";
  });
}

function linkedTo(record: EvidenceRecord, criterionId: string): boolean {
  return record.criterion_ids.includes(criterionId);
}

function criterionResults(snapshot: DossierSnapshot, observed: ObservedEvidenceProjection): CriterionResult[] {
  return snapshot.acceptance_criteria.map((criterion) => {
    if (criterion.verification === "recorded_human_review") {
      const linked = snapshot.evidence.filter((record) => linkedTo(record, criterion.criterion_id));
      return {
        criterion_id: criterion.criterion_id,
        status: linked.length > 0 ? "human_review_required" : "failed",
        supporting_evidence_ids: linked.map(({ evidence_id }) => evidence_id),
      };
    }
    const supporting = snapshot.evidence.filter((record, index) =>
      linkedTo(record, criterion.criterion_id)
      && (record.kind === "file" || record.kind === "command_result")
      && observed.evidence_results[index]?.status === "current");
    return {
      criterion_id: criterion.criterion_id,
      status: supporting.length > 0 ? "mechanically_satisfied" : "failed",
      supporting_evidence_ids: supporting.map(({ evidence_id }) => evidence_id),
    };
  });
}

/** Build the canonical, deterministic checks model from one validated snapshot and one observation pass. */
export function buildChecksProjection(
  snapshot: DossierSnapshot,
  observed: ObservedEvidenceProjection,
  envelopeIntegrity: boolean,
): ChecksProjection {
  const evidenceSafety = observed.evidence_results.every(({ status }) => status !== "unsafe");
  const bound = observationsAreBound(snapshot, observed);
  const evidenceIntegrity = evidenceIntegrityIsValid(snapshot, observed);
  const links = evidenceLinksAreValid(snapshot);
  const results = criterionResults(snapshot, observed);
  const invariants: InvariantResult[] = [
    { stage: "parse", code: "CASE_I_PARSE", status: "passed" },
    { stage: "schema", code: "CASE_I_SCHEMA", status: "passed" },
    { stage: "cross_file", code: "CASE_I_STATE", status: stateMetadataIsValid(snapshot) ? "passed" : "failed" },
    { stage: "evidence_safety", code: "CASE_I_EVIDENCE_SAFETY", status: evidenceSafety ? "passed" : "failed" },
    { stage: "evidence_integrity", code: "CASE_I_EVIDENCE_INTEGRITY", status: evidenceIntegrity ? "passed" : "failed" },
    { stage: "evidence_integrity", code: "CASE_I_EVIDENCE_LINKS", status: links ? "passed" : "failed" },
    { stage: "envelope_integrity", code: "CASE_I_ENVELOPE_INTEGRITY", status: envelopeIntegrity ? "passed" : "failed" },
    { stage: "derived_status", code: "CASE_I_DERIVED_STATUS", status: bound ? "passed" : "failed" },
  ];
  const warnings = results.some(({ status }) => status === "human_review_required")
    ? ["CASE_W_HUMAN_REVIEW_REQUIRED"]
    : [];
  const failed = invariants.some(({ status }) => status === "failed")
    || results.some(({ status }) => status === "failed");
  return {
    dossier_id: snapshot.dossier_id,
    content_digest: digestProjection(projectContent(snapshot)),
    observed_evidence_digest: digestProjection(projectObservedEvidence(observed)),
    invariant_results: invariants,
    criterion_results: results,
    stable_warning_codes: warnings,
    verdict: failed ? "failed" : "passed",
  };
}
