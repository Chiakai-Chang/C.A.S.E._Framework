import type { CaseCode } from "./errors.js";
import type { DossierSnapshot } from "./types.js";

export type TransitionProposal = {
  readonly kind: "add_evidence";
  readonly run_id: string;
};

export interface TransitionEvaluation {
  readonly allowed: boolean;
  readonly code: Extract<CaseCode, "CASE_OK" | "CASE_E_ACTOR" | "CASE_E_TRANSITION">;
}

/** Evaluate only the closed M0 transition vocabulary; brief editing is deliberately absent. */
export function evaluateTransition(
  snapshot: DossierSnapshot,
  proposal: TransitionProposal,
): TransitionEvaluation {
  if (proposal.kind !== "add_evidence") return { allowed: false, code: "CASE_E_TRANSITION" };
  if (proposal.run_id !== snapshot.active_run.run_id) return { allowed: false, code: "CASE_E_ACTOR" };
  return { allowed: true, code: "CASE_OK" };
}
