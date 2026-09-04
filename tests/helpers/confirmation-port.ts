import type {
  ConfirmationPort,
  ExactSubmissionReview,
  ProposedTransition,
} from "../../src/cli/confirm.js";
import type { CurrentView } from "../../src/protocol/types.js";

export interface RecordedConfirmation {
  readonly review: ExactSubmissionReview;
  readonly phrase: string;
}

/** Deterministic TTY/non-TTY confirmation double for workflow integration tests. */
export class ScriptedConfirmationPort implements ConfirmationPort {
  readonly decisionConfirmations: RecordedConfirmation[] = [];

  constructor(
    readonly interactive: boolean,
    private readonly answers: Array<boolean | Error> = [true],
  ) {}

  private answer(): boolean {
    const answer = this.answers.shift() ?? false;
    if (answer instanceof Error) throw answer;
    return answer;
  }

  async confirmBasis(_view: CurrentView, _transition: ProposedTransition): Promise<boolean> {
    return this.answer();
  }

  async confirmDecision(review: ExactSubmissionReview, phrase: string): Promise<boolean> {
    this.decisionConfirmations.push({ review, phrase });
    return this.answer();
  }
}
