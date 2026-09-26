// Stable error codes. The attack demo and the host dashboard count rejections by these.
export const ERROR_CODES = [
  "BAD_REQUEST",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "RATE_LIMITED",
  "WRONG_PHASE",
  "BAD_PROOF",
  "GATE_NULLIFIER_USED",
  "BAD_CODE",
  "CODE_USED",
  "ROOT_UNKNOWN",
  "ANON_SET_TOO_SMALL",
  "WRONG_SCOPE",
  "KEY_NOT_BOUND",
  "UNKNOWN_PID",
  "STALE_KEY",
  "BAD_SIGNATURE",
  "NONCE_REPLAY",
  "STATEMENT_NOT_OPEN",
  "DUPLICATE_STATEMENT",
  "CHAIN_ERROR",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class TsError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status = statusFor(code),
  ) {
    super(message);
  }
}

function statusFor(code: ErrorCode): number {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "UNAUTHORIZED":
      return 401;
    case "RATE_LIMITED":
      return 429;
    case "GATE_NULLIFIER_USED":
    case "CODE_USED":
    case "DUPLICATE_STATEMENT":
    case "NONCE_REPLAY":
      return 409;
    case "CHAIN_ERROR":
    case "INTERNAL":
      return 500;
    default:
      return 400;
  }
}
