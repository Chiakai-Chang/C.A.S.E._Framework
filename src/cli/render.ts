import type { ResultEnvelope } from "../protocol/result.js";

export interface OutputPort { write(text: string): void }

export function renderJson(result: ResultEnvelope<unknown>, output: OutputPort): void {
  output.write(`${JSON.stringify(result)}\n`);
}

export function renderHuman(result: ResultEnvelope<unknown>, output: OutputPort): void {
  const lines = [`${result.ok ? "OK" : "ERROR"} ${result.code}: ${result.message}`];
  if (result.ok && result.data !== null) {
    const data = result.data as Record<string, unknown>;
    const snapshot = typeof data.snapshot === "object" && data.snapshot !== null
      ? data.snapshot as Record<string, unknown> : data;
    const emit = (label: string, value: unknown): void => { if (typeof value === "string") lines.push(`${label}: ${value}`); };
    const abbreviated = (value: unknown): unknown => typeof value === "string" && value.startsWith("sha256:")
      ? `${value.slice(0, 19)}…` : value;
    emit("dossier ID", snapshot.dossier_id ?? data.dossier_id);
    emit("title", snapshot.title ?? data.title);
    emit("objective", snapshot.objective ?? data.objective);
    const active = snapshot.active_run as Record<string, unknown> | undefined;
    if (active !== undefined) { emit("active writer", active.actor_id); emit("active run", active.run_id); emit("started by handoff", active.started_by_handoff_id); }
    emit("revision", snapshot.state_revision ?? data.state_revision);
    emit("state digest", abbreviated(snapshot.state_digest ?? data.state_digest));
    for (const [key, label] of [
      ["evidence_id", "evidence ID"], ["artifact_digest", "artifact digest"],
      ["handoff_id", "handoff ID"], ["offered_content_digest", "offered content digest"],
      ["submission_id", "submission ID"], ["submission_digest", "submission digest"],
      ["decision_id", "decision ID"], ["reviewer_id", "reviewer"], ["quarantined_lock", "quarantined lock"],
      ["from_run_id", "from run"], ["to_actor_id", "to actor"], ["actor_id", "actor"],
      ["submitting_run_id", "submitting run"], ["created_operation_id", "operation ID"],
      ["basis_revision", "basis revision"], ["basis_state_digest", "basis state digest"],
      ["published_revision", "published revision"], ["content_digest", "content digest"],
      ["observed_evidence_digest", "observed evidence digest"], ["checks_digest", "checks digest"],
      ["decision", "decision"], ["comment", "comment"],
    ] as const) {
      emit(label, data[key] ?? snapshot[key]);
    }
    const evidence = data.evidence as Record<string, unknown> | undefined;
    if (evidence !== undefined) { emit("evidence ID", evidence.evidence_id); emit("artifact digest", evidence.artifact_digest); }
    for (const [key, label] of [["current_handoff_id", "current handoff ID"], ["current_submission_id", "current submission ID"], ["current_decision_id", "current decision ID"]] as const) emit(label, snapshot[key]);
    if (Array.isArray(data.criterion_results)) {
      for (const criterion of data.criterion_results.slice(0, 20) as Array<Record<string, unknown>>) emit("criterion", `${String(criterion.criterion_id)} = ${String(criterion.status)}`);
    }
    if (Array.isArray(data.evidence_gaps)) lines.push(`evidence gaps: ${(data.evidence_gaps as unknown[]).slice(0, 20).join(", ") || "none"}`);
    for (const key of ["current_checks", "review", "acceptance", "handoff"] as const) emit(key.replaceAll("_", " "), data[key]);
    emit("next", data.recommended_next_action);
    if (Array.isArray(data.unresolved_warnings)) lines.push(`warnings: ${(data.unresolved_warnings as unknown[]).slice(0, 20).join(", ") || "none"}`);
  }
  if (!result.ok && result.remediation !== null) lines.push(`Next: ${result.remediation}`);
  output.write(`${lines.join("\n")}\n`);
}
