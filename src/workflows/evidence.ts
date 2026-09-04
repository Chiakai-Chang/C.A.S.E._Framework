import { createHash } from "node:crypto";
import { join } from "node:path";
import { digestProjection } from "../protocol/canonical.js";
import { buildChecksProjection } from "../protocol/checks.js";
import { parseGovernedJson, type JsonValue } from "../protocol/json.js";
import { projectChecks, projectContent, projectObservedEvidence, projectState, projectSubmission } from "../protocol/projections.js";
import { failure, success, type FailureResultEnvelope, type ResultEnvelope } from "../protocol/result.js";
import { evaluateTransition } from "../protocol/transitions.js";
import {
  decimalString,
  digest,
  isDigest,
  isRevision,
  revision,
  type ChecksProjection,
  type CriterionResult,
  type DecisionEnvelope,
  type Digest,
  type DossierSnapshot,
  type EvidenceRecord,
  type Freshness,
  type HandoffEnvelope,
  type MutationPrecondition,
  type ObservedEvidenceProjection,
  type ObservedEvidenceResult,
  type SubmissionEnvelope,
} from "../protocol/types.js";
import { acquireWriterGuard, releaseGuard, type WriterGuard } from "../storage/guard.js";
import { commitSnapshotMutation } from "../storage/atomic.js";
import { nodePathInspection, resolveEvidencePath } from "../storage/paths.js";
import { isSafeOpaqueId, type ReadPorts, type WorkflowPorts } from "./dossier.js";

interface AddEvidenceCommon extends MutationPrecondition {
  run_id: string;
  criterion_ids: string[];
  freshness: Freshness;
  limitations: string[];
}

export type AddEvidenceRequest = AddEvidenceCommon & (
  | { kind: "file" | "command_result"; location: { repository_relative_path: string } }
  | { kind: "external_reference"; location: { uri: string } }
  | { kind: "human_observation"; location: { statement: string } }
);

export interface AddEvidenceResult {
  snapshot: DossierSnapshot;
  evidence: EvidenceRecord;
}

export interface CurrentEnvelopeInspection {
  readonly integrity: boolean;
  readonly handoff: HandoffEnvelope | null;
  readonly submission: SubmissionEnvelope | null;
  readonly decision: DecisionEnvelope | null;
}

export interface SnapshotCheckResult {
  readonly checks: ChecksProjection;
  readonly observed: ObservedEvidenceProjection;
  readonly envelopes: CurrentEnvelopeInspection;
  readonly orphanEnvelope: boolean;
}

/** Distinguish structural/cross-file failures from ordinary current-evidence failures. */
export function hasStructuralInvariantFailure(checks: ChecksProjection): boolean {
  return checks.invariant_results.some(({ stage, code, status }) => status === "failed" && (
    stage === "parse"
    || stage === "schema"
    || stage === "cross_file"
    || stage === "envelope_integrity"
    || stage === "derived_status"
    || code === "CASE_I_EVIDENCE_LINKS"
  ));
}

/** Exact public/checks.schema shape; source-only check stages never cross this boundary. */
export interface PublicChecksProjection {
  readonly dossier_id: string;
  readonly content_digest: Digest;
  readonly observed_evidence_digest: Digest;
  readonly invariant_results: Array<{ code: string; status: "passed" | "failed" }>;
  readonly criterion_results: CriterionResult[];
  readonly stable_warning_codes: string[];
  readonly verdict: "passed" | "failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(text);
}

function validateEvidenceRequest(value: unknown): value is AddEvidenceRequest {
  if (!isRecord(value) || !exactKeys(value, [
    "criterion_ids",
    "dossier_id",
    "expected_revision",
    "expected_state_digest",
    "freshness",
    "kind",
    "limitations",
    "location",
    "operation_id",
    "run_id",
  ])) return false;
  if (!isSafeOpaqueId(value.dossier_id) || !text(value.operation_id) || !isSafeOpaqueId(value.run_id)
    || !isRevision(value.expected_revision) || !isDigest(value.expected_state_digest)
    || !Array.isArray(value.criterion_ids) || value.criterion_ids.length === 0
    || !value.criterion_ids.every(isSafeOpaqueId)
    || new Set(value.criterion_ids).size !== value.criterion_ids.length
    || !strings(value.limitations) || !isRecord(value.location)) return false;
  if (value.kind === "file" || value.kind === "command_result") {
    return exactKeys(value.location, ["repository_relative_path"])
      && text(value.location.repository_relative_path)
      && (value.freshness === "immutable" || value.freshness === "recompute_on_check");
  }
  if (value.kind === "external_reference") {
    return exactKeys(value.location, ["uri"]) && text(value.location.uri) && value.freshness === "human_review";
  }
  if (value.kind === "human_observation") {
    return exactKeys(value.location, ["statement"]) && text(value.location.statement) && value.freshness === "human_review";
  }
  return false;
}

function inputProjection(request: AddEvidenceRequest): JsonValue {
  const common = {
    run_id: request.run_id,
    criterion_ids: [...request.criterion_ids],
    kind: request.kind,
    freshness: request.freshness,
    limitations: [...request.limitations],
  };
  if (request.kind === "file" || request.kind === "command_result") {
    return { ...common, location: { repository_relative_path: request.location.repository_relative_path } };
  }
  if (request.kind === "external_reference") return { ...common, location: { uri: request.location.uri } };
  return { ...common, location: { statement: "statement" in request.location ? request.location.statement : "" } };
}

async function failHeld(
  guard: WriterGuard,
  code: FailureResultEnvelope["code"],
  message: string,
): Promise<FailureResultEnvelope> {
  return await releaseGuard(guard)
    ? failure("evidence.add", code, message)
    : failure("evidence.add", "CASE_E_RECOVERY_REQUIRED", "The evidence mutation failed and its guard could not be released safely");
}

function rawDigest(bytes: Uint8Array) {
  return digest(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
}

/** Register one evidence record under the existing-dossier mutation guard. */
export async function addEvidence(
  request: AddEvidenceRequest,
  ports: WorkflowPorts,
): Promise<ResultEnvelope<AddEvidenceResult>> {
  if (!validateEvidenceRequest(request)) {
    return failure("evidence.add", "CASE_E_USAGE", "A valid tagged evidence request and mutation precondition are required");
  }
  let evidenceId: string;
  try {
    evidenceId = ports.ids.evidenceIdFor(request.operation_id);
    if (!isSafeOpaqueId(evidenceId)) throw new Error("unsafe evidence id");
  } catch {
    return failure("evidence.add", "CASE_E_INTERNAL", "A safe evidence identifier could not be derived");
  }
  const inputDigest = digestProjection(inputProjection(request));
  const guard = await acquireWriterGuard(ports.store, {
    dossier_id: request.dossier_id,
    expected_revision: request.expected_revision,
    expected_state_digest: request.expected_state_digest,
    operation_id: request.operation_id,
    input_digest: inputDigest,
  }, ports);
  if (guard.mode === "failed") return guard.acquisitionFailure ?? failure("evidence.add", "CASE_E_INTERNAL", "Writer acquisition failed");
  if (guard.basis === null) return failHeld(guard, "CASE_E_INTERNAL", "The evidence mutation has no validated basis");

  if (guard.mode === "retry") {
    return commitSnapshotMutation(guard, () => failure("evidence.add", "CASE_E_INTERNAL", "Retry unexpectedly invoked the mutation builder"),
      (committed) => {
        const evidence = committed.evidence.find(({ evidence_id }) => evidence_id === evidenceId);
        if (evidence === undefined) throw new Error("committed evidence is missing");
        return { snapshot: committed, evidence };
      });
  }

  const transition = evaluateTransition(guard.basis, { kind: "add_evidence", run_id: request.run_id });
  if (!transition.allowed) {
    return failHeld(guard, transition.code === "CASE_E_ACTOR" ? "CASE_E_ACTOR" : "CASE_E_TRANSITION",
      "The active run does not authorize this evidence mutation");
  }
  const criteria = new Set(guard.basis.acceptance_criteria.map(({ criterion_id }) => criterion_id));
  if (!request.criterion_ids.every((criterionId) => criteria.has(criterionId))) {
    return failHeld(guard, "CASE_E_USAGE", "Evidence may link only existing criterion IDs");
  }
  if (guard.basis.evidence.some(({ evidence_id }) => evidence_id === evidenceId)) {
    return failHeld(guard, "CASE_E_CONFLICT", "The derived evidence ID is already in use");
  }

  let evidence: EvidenceRecord;
  try {
    const capturedAt = ports.clock.now();
    if (request.kind === "file" || request.kind === "command_result") {
      const opened = await resolveEvidencePath(
        ports.repository_root,
        request.location.repository_relative_path,
        ports.evidenceFs ?? nodePathInspection,
      );
      let bytes: Uint8Array;
      try {
        bytes = await opened.handle.readAll();
      } finally {
        await opened.handle.close();
      }
      if (bytes.byteLength === 0) return failHeld(guard, "CASE_E_EVIDENCE", "Empty local evidence cannot be registered");
      evidence = {
        evidence_id: evidenceId,
        criterion_ids: [...request.criterion_ids],
        captured_at: capturedAt,
        freshness: request.freshness,
        limitations: [...request.limitations],
        kind: request.kind,
        location: { repository_relative_path: opened.repository_relative_path },
        artifact_digest: rawDigest(bytes),
        artifact_size: decimalString(bytes.byteLength.toString()),
      };
    } else if (request.kind === "external_reference") {
      evidence = {
        evidence_id: evidenceId,
        criterion_ids: [...request.criterion_ids],
        captured_at: capturedAt,
        freshness: "human_review",
        limitations: [...request.limitations],
        kind: "external_reference",
        location: { uri: request.location.uri },
      };
    } else {
      evidence = {
        evidence_id: evidenceId,
        criterion_ids: [...request.criterion_ids],
        captured_at: capturedAt,
        freshness: "human_review",
        limitations: [...request.limitations],
        kind: "human_observation",
        location: { statement: "statement" in request.location ? request.location.statement : "" },
      };
    }
  } catch {
    return failHeld(guard, "CASE_E_EVIDENCE", "The evidence artifact could not be opened and captured safely");
  }

  return commitSnapshotMutation(guard, (basis) => {
    const resultingRevision = revision((BigInt(basis.state_revision) + 1n).toString());
    const candidate: DossierSnapshot = {
      ...basis,
      state_revision: resultingRevision,
      state_digest: digestProjection({}),
      last_operation: {
        operation_id: request.operation_id,
        input_digest: inputDigest,
        basis_revision: request.expected_revision,
        resulting_revision: resultingRevision,
      },
      evidence: [...basis.evidence, evidence],
    };
    const snapshot = { ...candidate, state_digest: digestProjection(projectState(candidate)) };
    return { snapshot, data: { snapshot, evidence } };
  });
}

function missingEvidenceError(error: unknown): boolean {
  if (!(error instanceof Error) || !error.message.startsWith("CASE_E_EVIDENCE:")) return false;
  return error.message.includes("does not resolve exactly")
    || error.message.includes("path parent is unavailable")
    || error.message.includes("path segment is unavailable");
}

async function observeLocal(record: Extract<EvidenceRecord, { kind: "file" | "command_result" }>, ports: ReadPorts): Promise<ObservedEvidenceResult> {
  let opened;
  try {
    opened = await resolveEvidencePath(
      ports.repository_root,
      record.location.repository_relative_path,
      ports.evidenceFs ?? nodePathInspection,
    );
  } catch (error) {
    const missing = missingEvidenceError(error);
    return {
      evidence_id: record.evidence_id,
      status: missing ? "missing" : "unsafe",
      observed_artifact_digest: null,
      observed_artifact_size: null,
      stable_limitation_codes: [missing ? "CASE_L_EVIDENCE_MISSING" : "CASE_L_EVIDENCE_UNSAFE"],
    };
  }
  let closed = false;
  try {
    const bytes = await opened.handle.readAll();
    await opened.handle.close();
    closed = true;
    const observedDigest = rawDigest(bytes);
    const observedSize = decimalString(bytes.byteLength.toString());
    if (bytes.byteLength === 0) {
      return {
        evidence_id: record.evidence_id,
        status: "empty",
        observed_artifact_digest: observedDigest,
        observed_artifact_size: observedSize,
        stable_limitation_codes: ["CASE_L_EVIDENCE_EMPTY"],
      };
    }
    const changed = observedDigest !== record.artifact_digest || observedSize !== record.artifact_size;
    return {
      evidence_id: record.evidence_id,
      status: changed ? "changed" : "current",
      observed_artifact_digest: observedDigest,
      observed_artifact_size: observedSize,
      stable_limitation_codes: changed ? ["CASE_L_EVIDENCE_CHANGED"] : [],
    };
  } catch {
    return {
      evidence_id: record.evidence_id,
      status: "unsafe",
      observed_artifact_digest: null,
      observed_artifact_size: null,
      stable_limitation_codes: ["CASE_L_EVIDENCE_UNSAFE"],
    };
  } finally {
    if (!closed) {
      try { await opened.handle.close(); } catch { /* result is already unsafe */ }
    }
  }
}

async function observeEvidence(snapshot: DossierSnapshot, ports: ReadPorts): Promise<ObservedEvidenceProjection> {
  const results: ObservedEvidenceResult[] = [];
  for (const record of snapshot.evidence) {
    if (record.kind === "file" || record.kind === "command_result") results.push(await observeLocal(record, ports));
    else results.push({
      evidence_id: record.evidence_id,
      status: "human_review_required",
      observed_artifact_digest: null,
      observed_artifact_size: null,
      stable_limitation_codes: ["CASE_L_HUMAN_REVIEW_REQUIRED"],
    });
  }
  return {
    dossier_id: snapshot.dossier_id,
    content_digest: digestProjection(projectContent(snapshot)),
    evidence_results: results,
  };
}

async function readEnvelope(
  snapshot: DossierSnapshot,
  kind: "handoff" | "submission" | "decision",
  id: string,
  ports: ReadPorts,
): Promise<JsonValue | null> {
  try {
    return await readEnvelopeStrict(snapshot, kind, id, ports);
  } catch {
    return null;
  }
}

async function readEnvelopeStrict(
  snapshot: DossierSnapshot,
  kind: "handoff" | "submission" | "decision",
  id: string,
  ports: ReadPorts,
): Promise<JsonValue> {
  const opened = await resolveEvidencePath(
    ports.repository_root,
    `.case-agent/dossiers/${snapshot.dossier_id}/${kind}s/${id}.json`,
    ports.evidenceFs ?? nodePathInspection,
  );
  let parsed: JsonValue;
  try {
    parsed = parseGovernedJson(await opened.handle.readAll());
  } finally {
    await opened.handle.close();
  }
  const validation = ports.schemas.validate(kind, parsed);
  if (!validation.ok) throw new Error("envelope schema validation failed");
  return parsed;
}

export async function inspectCurrentEnvelopes(snapshot: DossierSnapshot, ports: ReadPorts): Promise<CurrentEnvelopeInspection> {
  let integrity = true;
  let handoff: HandoffEnvelope | null = null;
  let submission: SubmissionEnvelope | null = null;
  let decision: DecisionEnvelope | null = null;

  if (snapshot.current_handoff_id !== null) {
    const parsed = await readEnvelope(snapshot, "handoff", snapshot.current_handoff_id, ports);
    handoff = parsed as unknown as HandoffEnvelope | null;
    try {
      integrity = integrity && handoff !== null
        && handoff.handoff_id === snapshot.current_handoff_id
        && handoff.dossier_id === snapshot.dossier_id
        && BigInt(handoff.basis_revision) + 1n === BigInt(handoff.published_revision);
    } catch { integrity = false; }
  }
  if (snapshot.current_submission_id !== null) {
    const parsed = await readEnvelope(snapshot, "submission", snapshot.current_submission_id, ports);
    submission = parsed as unknown as SubmissionEnvelope | null;
    integrity = integrity && submission !== null
      && submission.submission_id === snapshot.current_submission_id
      && submission.dossier_id === snapshot.dossier_id
      && submission.submission_digest === digestProjection(projectSubmission(submission));
  }
  if (snapshot.current_decision_id !== null) {
    const parsed = await readEnvelope(snapshot, "decision", snapshot.current_decision_id, ports);
    decision = parsed as unknown as DecisionEnvelope | null;
    const expectedCriteria = snapshot.acceptance_criteria.map(({ criterion_id }) => criterion_id);
    integrity = integrity && decision !== null
      && decision.decision_id === snapshot.current_decision_id
      && decision.dossier_id === snapshot.dossier_id
      && submission !== null
      && decision.submission_id === submission.submission_id
      && decision.submission_digest === submission.submission_digest
      && decision.criteria_reviewed.length === expectedCriteria.length
      && decision.criteria_reviewed.every((criterionId, index) => criterionId === expectedCriteria[index]);
  }
  return { integrity, handoff, submission, decision };
}

type EnvelopeHistoryPosition = "current" | "recoverable" | "superseded";

interface ValidatedSubmissionHistory {
  readonly envelope: SubmissionEnvelope;
  readonly position: EnvelopeHistoryPosition;
}

function assertOrphanEnvelopeSemantics(
  snapshot: DossierSnapshot,
  kind: "handoff" | "submission" | "decision",
  id: string,
  parsed: JsonValue,
  checks: ChecksProjection,
): Exclude<EnvelopeHistoryPosition, "current"> {
  if (kind === "decision") throw new Error("decision semantics require its referenced submission");
  const envelope = parsed as unknown as HandoffEnvelope | SubmissionEnvelope;
  const basis = BigInt(envelope.basis_revision);
  const published = BigInt(envelope.published_revision);
  const current = BigInt(snapshot.state_revision);
  const addressedId = kind === "handoff"
    ? (envelope as HandoffEnvelope).handoff_id
    : (envelope as SubmissionEnvelope).submission_id;
  if (addressedId !== id
    || envelope.dossier_id !== snapshot.dossier_id
    || published !== basis + 1n
    || basis > current) {
    throw new Error(`orphan ${kind} envelope is semantically incoherent`);
  }
  if (kind === "handoff") {
    const handoff = envelope as HandoffEnvelope;
    if (basis === current && (
      handoff.from_run_id !== snapshot.active_run.run_id
      || handoff.basis_state_digest !== snapshot.state_digest
      || handoff.offered_content_digest !== digestProjection(projectContent(snapshot))
    )) throw new Error("orphan handoff envelope is not exact for its current basis");
    return basis === current ? "recoverable" : "superseded";
  }
  const submission = envelope as SubmissionEnvelope;
  if (submission.submission_digest !== digestProjection(projectSubmission(submission))
    || (basis === current && (
      submission.submitting_run_id !== snapshot.active_run.run_id
      || submission.basis_state_digest !== snapshot.state_digest
      || submission.content_digest !== digestProjection(projectContent(snapshot))
      || submission.observed_evidence_digest !== checks.observed_evidence_digest
      || submission.checks_digest !== digestProjection(projectChecks(checks))
    ))) {
    throw new Error("orphan submission envelope is not self-consistent for its basis");
  }
  return basis === current ? "recoverable" : "superseded";
}

function assertCurrentSubmissionSemantics(
  snapshot: DossierSnapshot,
  submission: SubmissionEnvelope,
  checks: ChecksProjection,
): "current" | "superseded" {
  const basis = BigInt(submission.basis_revision);
  const published = BigInt(submission.published_revision);
  const current = BigInt(snapshot.state_revision);
  if (submission.submission_id !== snapshot.current_submission_id
    || submission.dossier_id !== snapshot.dossier_id
    || published !== basis + 1n
    || published > current
    || submission.submission_digest !== digestProjection(projectSubmission(submission))
    || (published === current && (
      submission.content_digest !== digestProjection(projectContent(snapshot))
      || submission.observed_evidence_digest !== checks.observed_evidence_digest
      || submission.checks_digest !== digestProjection(projectChecks(checks))
    ))) {
    throw new Error("current submission envelope is not self-consistent with the current dossier");
  }
  return published === current ? "current" : "superseded";
}

function decisionHistoryPosition(
  snapshot: DossierSnapshot,
  id: string,
  parsed: JsonValue,
  submissions: ReadonlyMap<string, ValidatedSubmissionHistory>,
): Exclude<EnvelopeHistoryPosition, "current"> {
  const decision = parsed as unknown as DecisionEnvelope;
  const expectedCriteria = snapshot.acceptance_criteria.map(({ criterion_id }) => criterion_id);
  const submission = submissions.get(decision.submission_id);
  if (decision.decision_id !== id
    || decision.dossier_id !== snapshot.dossier_id
    || submission === undefined
    || submission.position === "recoverable"
    || decision.submission_digest !== submission.envelope.submission_digest
    || decision.criteria_reviewed.length !== expectedCriteria.length
    || !decision.criteria_reviewed.every((criterionId, index) => criterionId === expectedCriteria[index])) {
    throw new Error("orphan decision envelope is not coherent with an addressable published submission");
  }
  return submission.position === "current" ? "recoverable" : "superseded";
}

async function hasUnreferencedEnvelope(
  snapshot: DossierSnapshot,
  currentEnvelopes: CurrentEnvelopeInspection,
  checks: ChecksProjection,
  ports: ReadPorts,
): Promise<boolean> {
  const fs = ports.evidenceFs ?? nodePathInspection;
  const dossierRoot = join(ports.repository_root, ".case-agent", "dossiers", snapshot.dossier_id);
  const current = new Map<"handoff" | "submission" | "decision", string | null>([
    ["handoff", snapshot.current_handoff_id],
    ["submission", snapshot.current_submission_id],
    ["decision", snapshot.current_decision_id],
  ]);
  const submissions = new Map<string, ValidatedSubmissionHistory>();
  let orphan = false;
  let scanTrusted = true;
  if (snapshot.current_submission_id !== null) {
    try {
      if (currentEnvelopes.submission === null) throw new Error("current submission is unavailable");
      const position = assertCurrentSubmissionSemantics(snapshot, currentEnvelopes.submission, checks);
      submissions.set(snapshot.current_submission_id, {
        envelope: currentEnvelopes.submission,
        position,
      });
    } catch {
      // Current referenced envelope damage is already represented by the
      // closed envelope-integrity check. It is not unreferenced history, so it
      // does not make the directory scan itself untrustworthy. Keeping it out
      // of this map still makes any orphan decision that cites it fail closed.
    }
  }
  for (const [kind, currentId] of current) {
    let entries: readonly { readonly name: string }[];
    try {
      entries = await fs.listDirectory(join(dossierRoot, `${kind}s`));
    } catch {
      scanTrusted = false;
      continue;
    }
    for (const { name } of [...entries].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      if (currentId !== null && name === `${currentId}.json`) continue;
      if (!/^[A-Za-z0-9._-]+\.json$/u.test(name)) {
        scanTrusted = false;
        continue;
      }
      const id = name.slice(0, -5);
      try {
        const parsed = await readEnvelopeStrict(snapshot, kind, id, ports);
        if (kind === "decision") {
          const position = decisionHistoryPosition(snapshot, id, parsed, submissions);
          if (position === "recoverable") orphan = true;
        } else {
          const position = assertOrphanEnvelopeSemantics(snapshot, kind, id, parsed, checks);
          if (kind === "submission") {
            submissions.set(id, { envelope: parsed as unknown as SubmissionEnvelope, position });
          }
          if (position === "recoverable") orphan = true;
        }
      } catch {
        scanTrusted = false;
      }
    }
  }
  if (!scanTrusted) throw new Error("CASE_E_INVARIANT: immutable envelope history could not be scanned safely");
  return orphan;
}

/** Recompute evidence, envelope, and criterion state from a validated in-memory snapshot. */
export async function checkSnapshot(snapshot: DossierSnapshot, ports: ReadPorts): Promise<SnapshotCheckResult> {
  const observed = await observeEvidence(snapshot, ports);
  const envelopes = await inspectCurrentEnvelopes(snapshot, ports);
  const checks = buildChecksProjection(snapshot, observed, envelopes.integrity);
  checks.stable_warning_codes = [...new Set([
    ...checks.stable_warning_codes,
    ...observed.evidence_results.flatMap(({ stable_limitation_codes }) => stable_limitation_codes),
  ])].sort();
  if (!ports.schemas.validate("observed-evidence", projectObservedEvidence(observed)).ok
    || !ports.schemas.validate("checks", projectChecks(checks)).ok) {
    throw new Error("generated check projection validation failed");
  }
  const orphanEnvelope = await hasUnreferencedEnvelope(snapshot, envelopes, checks, ports);
  return { checks, observed, envelopes, orphanEnvelope };
}

function loadFailure(error: unknown): FailureResultEnvelope {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("CASE_E_PARSE:")) return failure("dossier.check", "CASE_E_PARSE", "The addressed dossier could not be parsed");
  if (message.startsWith("CASE_E_SCHEMA:")) return failure("dossier.check", "CASE_E_SCHEMA", "The addressed dossier does not match its schema");
  if (message.startsWith("CASE_E_UNSUPPORTED_VERSION:")) {
    return failure("dossier.check", "CASE_E_UNSUPPORTED_VERSION", "The addressed dossier uses an unsupported protocol version");
  }
  if (message.startsWith("CASE_E_INVARIANT:")) return failure("dossier.check", "CASE_E_INVARIANT", "The addressed dossier is unavailable or inconsistent");
  return failure("dossier.check", "CASE_E_INTERNAL", "The dossier check failed unexpectedly");
}

/** Recompute deterministic checks without mutating the dossier snapshot. */
export async function checkDossier(
  request: { dossier_id: string },
  ports: ReadPorts,
): Promise<ResultEnvelope<PublicChecksProjection>> {
  if (!isSafeOpaqueId(request.dossier_id)) {
    return failure("dossier.check", "CASE_E_USAGE", "An explicit valid dossier ID is required");
  }
  try {
    const snapshot = await ports.store.loadDossier(request.dossier_id);
    const { checks, orphanEnvelope } = await checkSnapshot(snapshot, ports);
    const projected = projectChecks(checks) as unknown as PublicChecksProjection;
    const publicChecks: PublicChecksProjection = orphanEnvelope ? {
      ...projected,
      stable_warning_codes: [...new Set([
        ...projected.stable_warning_codes,
        "CASE_L_ORPHAN_ENVELOPE",
      ])].sort(),
    } : projected;
    if (!ports.schemas.validate("checks", publicChecks).ok) {
      return failure("dossier.check", "CASE_E_INTERNAL", "The public checks projection failed validation");
    }
    return success(
      "dossier.check",
      publicChecks.verdict === "passed" ? "Dossier checks passed" : "Dossier checks failed",
      publicChecks,
    );
  } catch (error) {
    return loadFailure(error);
  }
}
