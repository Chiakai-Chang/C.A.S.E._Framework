import type { ResultEnvelope } from "../protocol/result.js";

export interface OutputPort { write(text: string): void }

const MAX_HUMAN_COLLECTION_ITEMS = 20;
const MAX_HUMAN_FIELD_BYTES = 256;
export const MAX_HUMAN_OUTPUT_BYTES = 16_384;
const DEEPER_ROUTE = "deeper: output abbreviated; rerun with --json for complete data";

export function renderJson(result: ResultEnvelope<unknown>, output: OutputPort): void {
  output.write(`${JSON.stringify(result)}\n`);
}

type HumanLine = { readonly text: string; readonly required: boolean };
type HumanCollection = {
  readonly summaryLabel: string;
  readonly itemLabel: string;
  readonly total: number;
  readonly items: string[];
};

function truncateUtf8(value: string): { readonly text: string; readonly truncated: boolean } {
  if (Buffer.byteLength(value, "utf8") <= MAX_HUMAN_FIELD_BYTES) return { text: value, truncated: false };
  const ellipsis = "…";
  const ellipsisBytes = Buffer.byteLength(ellipsis, "utf8");
  let text = "";
  let bytes = 0;
  for (const scalar of value) {
    const scalarBytes = Buffer.byteLength(scalar, "utf8");
    if (bytes + scalarBytes + ellipsisBytes > MAX_HUMAN_FIELD_BYTES) break;
    text += scalar;
    bytes += scalarBytes;
  }
  return { text: `${text}${ellipsis}`, truncated: true };
}

export function renderHuman(result: ResultEnvelope<unknown>, output: OutputPort): void {
  let fieldTruncated = false;
  let optionalRemoved = false;
  const bounded = (value: string): string => {
    const truncated = truncateUtf8(value);
    fieldTruncated ||= truncated.truncated;
    return truncated.text;
  };
  const lines: HumanLine[] = [{
    text: `${result.ok ? "OK" : "ERROR"} ${result.code}: ${bounded(result.message)}`,
    required: true,
  }];
  const collections: HumanCollection[] = [];
  const emit = (label: string, value: unknown, required = false): void => {
    if (typeof value === "string") lines.push({ text: `${label}: ${bounded(value)}`, required });
  };
  const abbreviatedDigest = (value: unknown): unknown => typeof value === "string" && value.startsWith("sha256:")
    ? `${value.slice(0, 19)}…` : value;

  if (result.ok && result.data !== null) {
    const data = result.data as Record<string, unknown>;
    const snapshot = typeof data.snapshot === "object" && data.snapshot !== null
      ? data.snapshot as Record<string, unknown> : data;
    emit("dossier ID", snapshot.dossier_id ?? data.dossier_id, true);
    emit("title", snapshot.title ?? data.title);
    emit("objective", snapshot.objective ?? data.objective);
    const active = snapshot.active_run as Record<string, unknown> | undefined;
    if (active !== undefined) {
      emit("active writer", active.actor_id);
      emit("active run", active.run_id, true);
      emit("started by handoff", active.started_by_handoff_id, true);
    }
    emit("revision", snapshot.state_revision ?? data.state_revision, true);
    emit("state digest", abbreviatedDigest(snapshot.state_digest ?? data.state_digest), true);
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
      emit(label, data[key] ?? snapshot[key], label.endsWith(" ID") || label.endsWith(" digest"));
    }
    const evidence = data.evidence as Record<string, unknown> | undefined;
    if (evidence !== undefined) {
      emit("evidence ID", evidence.evidence_id, true);
      emit("artifact digest", evidence.artifact_digest, true);
    }
    for (const [key, label] of [
      ["current_handoff_id", "current handoff ID"],
      ["current_submission_id", "current submission ID"],
      ["current_decision_id", "current decision ID"],
    ] as const) emit(label, snapshot[key], true);
    for (const [key, label] of [
      ["current_checks", "current checks"], ["review", "review"],
      ["acceptance", "acceptance"], ["handoff", "handoff"],
    ] as const) emit(label, data[key]);
    emit("next", data.recommended_next_action, true);

    if (Array.isArray(data.criterion_results)) {
      collections.push({
        summaryLabel: "criteria",
        itemLabel: "criterion",
        total: data.criterion_results.length,
        items: (data.criterion_results as Array<Record<string, unknown>>)
          .slice(0, MAX_HUMAN_COLLECTION_ITEMS)
          .map((criterion) => bounded(`${String(criterion.criterion_id)} = ${String(criterion.status)}`)),
      });
    }
    if (Array.isArray(data.evidence_gaps)) {
      collections.push({
        summaryLabel: "evidence gaps",
        itemLabel: "evidence gap",
        total: data.evidence_gaps.length,
        items: (data.evidence_gaps as unknown[])
          .slice(0, MAX_HUMAN_COLLECTION_ITEMS)
          .map((gap) => bounded(String(gap))),
      });
    }
    if (Array.isArray(data.unresolved_warnings)) {
      collections.push({
        summaryLabel: "warnings",
        itemLabel: "warning",
        total: data.unresolved_warnings.length,
        items: (data.unresolved_warnings as unknown[])
          .slice(0, MAX_HUMAN_COLLECTION_ITEMS)
          .map((warning) => bounded(String(warning))),
      });
    }
  }
  if (!result.ok && result.remediation !== null) emit("Next", result.remediation, true);

  const assemble = (): string => {
    const abbreviated = fieldTruncated || optionalRemoved
      || collections.some((collection) => collection.items.length < collection.total);
    const rendered = lines.map(({ text }) => text);
    for (const collection of collections) {
      rendered.push(`${collection.summaryLabel}: total=${collection.total} shown=${collection.items.length} omitted=${collection.total - collection.items.length}`);
      rendered.push(...collection.items.map((item) => `${collection.itemLabel}: ${item}`));
    }
    if (abbreviated) rendered.push(DEEPER_ROUTE);
    return `${rendered.join("\n")}\n`;
  };

  let rendered = assemble();
  const reductionOrder = [...collections].reverse();
  while (Buffer.byteLength(rendered, "utf8") > MAX_HUMAN_OUTPUT_BYTES) {
    const reducibleCollection = reductionOrder.find((collection) => collection.items.length > 0);
    if (reducibleCollection !== undefined) {
      reducibleCollection.items.pop();
      optionalRemoved = true;
    } else {
      const optionalIndex = lines.findLastIndex(({ required }) => !required);
      if (optionalIndex < 0) throw new Error("bounded human output invariant exceeded");
      lines.splice(optionalIndex, 1);
      optionalRemoved = true;
    }
    rendered = assemble();
  }
  output.write(rendered);
}
