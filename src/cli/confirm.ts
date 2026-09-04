import type { AcceptanceCriterion, CurrentView, DecisionEnvelope, SubmissionEnvelope } from "../protocol/types.js";

export const DECISION_CONFIRMATION_PHRASE = "RECORD THIS HUMAN DECISION";
export const RECORDED_IDENTITY_LIMITATION = "Recorded interactive claim; not authentication or non-repudiation.";

export interface ProposedTransition {
  readonly command: string;
  readonly operation_id: string;
}

export interface ExactSubmissionReview {
  readonly submission: SubmissionEnvelope;
  readonly acceptance_criteria: AcceptanceCriterion[];
  readonly decision_envelope: DecisionEnvelope;
  readonly identity_limitation: typeof RECORDED_IDENTITY_LIMITATION;
}

/** A confirmation source must explicitly attest that it is backed by an interactive TTY. */
export interface ConfirmationPort {
  readonly interactive: boolean;
  confirmBasis(view: CurrentView, transition: ProposedTransition): Promise<boolean>;
  confirmDecision(review: ExactSubmissionReview, phrase: string): Promise<boolean>;
}
