import { parseGovernedJson, type JsonValue } from "../protocol/json.js";
import type { SchemaRegistry } from "../protocol/schema-registry.js";
import {
  decimalString,
  digest,
  revision,
  type AcceptanceCriterion,
  type ActiveRun,
  type DossierSnapshot,
  type EvidenceRecord,
  type LastOperation,
} from "../protocol/types.js";
import {
  nodePathInspection,
  resolveEvidencePath,
  type PathInspectionPort,
} from "./paths.js";

function record(value: JsonValue): Record<string, JsonValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("CASE_E_INTERNAL: validated dossier is not an object");
  }
  return value;
}

function strings(value: JsonValue): string[] {
  return (value as JsonValue[]).map((entry) => entry as string);
}

function acceptanceCriteria(value: JsonValue): AcceptanceCriterion[] {
  return (value as JsonValue[]).map((entry) => {
    const criterion = record(entry);
    return {
      criterion_id: criterion.criterion_id as string,
      statement: criterion.statement as string,
      verification: criterion.verification as AcceptanceCriterion["verification"],
    };
  });
}

function activeRun(value: JsonValue): ActiveRun {
  const active = record(value);
  return {
    run_id: active.run_id as string,
    actor_id: active.actor_id as string,
    started_by_handoff_id: active.started_by_handoff_id as string | null,
  };
}

function lastOperation(value: JsonValue): LastOperation | null {
  if (value === null) return null;
  const operation = record(value);
  return {
    operation_id: operation.operation_id as string,
    input_digest: digest(operation.input_digest as string),
    basis_revision: revision(operation.basis_revision as string),
    resulting_revision: revision(operation.resulting_revision as string),
  };
}

function evidenceRecords(value: JsonValue): EvidenceRecord[] {
  return (value as JsonValue[]).map((entry) => {
    const evidence = record(entry);
    const location = record(evidence.location!);
    const common = {
      evidence_id: evidence.evidence_id as string,
      criterion_ids: strings(evidence.criterion_ids!),
      captured_at: evidence.captured_at as string,
      freshness: evidence.freshness as EvidenceRecord["freshness"],
      limitations: strings(evidence.limitations!),
    };
    if (evidence.kind === "file" || evidence.kind === "command_result") {
      return {
        ...common,
        kind: evidence.kind,
        location: { repository_relative_path: location.repository_relative_path as string },
        artifact_digest: digest(evidence.artifact_digest as string),
        artifact_size: decimalString(evidence.artifact_size as string),
      } as EvidenceRecord;
    }
    if (evidence.kind === "external_reference") {
      return { ...common, kind: "external_reference", location: { uri: location.uri as string } };
    }
    return {
      ...common,
      kind: "human_observation",
      location: { statement: location.statement as string },
    };
  });
}

function dossierFromJson(value: JsonValue): DossierSnapshot {
  const dossier = record(value);
  const scope = record(dossier.scope!);
  return {
    dossier_id: dossier.dossier_id as string,
    title: dossier.title as string,
    objective: dossier.objective as string,
    scope: { in: strings(scope.in!), out: strings(scope.out!) },
    constraints: strings(dossier.constraints!),
    acceptance_criteria: acceptanceCriteria(dossier.acceptance_criteria!),
    state_revision: revision(dossier.state_revision as string),
    state_digest: digest(dossier.state_digest as string),
    last_operation: lastOperation(dossier.last_operation!),
    active_run: activeRun(dossier.active_run!),
    evidence: evidenceRecords(dossier.evidence!),
    current_handoff_id: dossier.current_handoff_id as string | null,
    current_submission_id: dossier.current_submission_id as string | null,
    current_decision_id: dossier.current_decision_id as string | null,
  };
}

function validateDossierId(id: string): void {
  if (id.length === 0 || id === "." || id === ".." || id.includes("/") || id.includes("\\") || id.includes("\0")) {
    throw new Error("CASE_E_INVARIANT: invalid dossier ID");
  }
}

/** Read one explicitly addressed dossier through the confined evidence opener. */
export class CaseStore {
  constructor(
    private readonly repositoryRoot: string,
    private readonly schemas: SchemaRegistry,
    private readonly fs: PathInspectionPort = nodePathInspection,
  ) {}

  async loadDossier(id: string): Promise<DossierSnapshot> {
    validateDossierId(id);
    let opened;
    try {
      opened = await resolveEvidencePath(
        this.repositoryRoot,
        `.case-agent/dossiers/${id}/dossier.json`,
        this.fs,
      );
    } catch {
      throw new Error("CASE_E_INVARIANT: addressed dossier is unavailable or unsafe");
    }

    let value: JsonValue;
    try {
      value = parseGovernedJson(await opened.handle.readAll());
    } finally {
      await opened.handle.close();
    }

    let validation;
    try {
      validation = this.schemas.validate("dossier", value);
    } catch {
      throw new Error("CASE_E_INTERNAL: dossier validator failed");
    }
    if (!validation.ok) throw new Error(`${validation.code}: stored dossier is invalid`);

    const dossier = dossierFromJson(value);
    if (dossier.dossier_id !== id) {
      throw new Error("CASE_E_INVARIANT: stored dossier ID does not match its address");
    }
    return dossier;
  }
}
