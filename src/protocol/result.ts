import type { CaseCode, CaseError } from "./errors.js";

export interface SuccessResultEnvelope<T> {
  ok: true;
  command: string;
  code: Extract<CaseCode, "CASE_OK">;
  message: string;
  data: T;
  remediation: null;
}

export interface FailureResultEnvelope {
  ok: false;
  command: string;
  code: CaseError;
  message: string;
  data: null;
  remediation: string | null;
}

export type ResultEnvelope<T> = SuccessResultEnvelope<T> | FailureResultEnvelope;

export function success<T>(command: string, message: string, data: T): SuccessResultEnvelope<T> {
  return { ok: true, command, code: "CASE_OK", message, data, remediation: null };
}

export function failure(
  command: string,
  code: CaseError,
  message: string,
  remediation: string | null = null,
): FailureResultEnvelope {
  return { ok: false, command, code, message, data: null, remediation };
}
