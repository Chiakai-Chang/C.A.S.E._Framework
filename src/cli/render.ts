import type { ResultEnvelope } from "../protocol/result.js";

export interface OutputPort { write(text: string): void }

export function renderJson(result: ResultEnvelope<unknown>, output: OutputPort): void {
  output.write(`${JSON.stringify(result)}\n`);
}

export function renderHuman(result: ResultEnvelope<unknown>, output: OutputPort): void {
  const lines = [`${result.ok ? "OK" : "ERROR"} ${result.code}: ${result.message}`];
  if (result.ok && result.data !== null) {
    const data = result.data as Record<string, unknown>;
    for (const key of ["dossier_id", "title", "objective", "state_revision", "state_digest", "recommended_next_action"] as const) {
      if (data[key] !== undefined) lines.push(`${key}: ${String(data[key])}`);
    }
  }
  if (!result.ok && result.remediation !== null) lines.push(`Next: ${result.remediation}`);
  output.write(`${lines.join("\n")}\n`);
}
