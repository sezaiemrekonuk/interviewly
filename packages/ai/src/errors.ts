/**
 * Errors this package throws. The `code` is the stable SCREAMING_SNAKE_CASE string from
 * `backend/src/lib/error-codes.ts` (F01) — backend maps it onto an HTTP envelope. The
 * package never imports that registry: `@interviewly/ai` is shared by `api` and `worker`
 * (K1) and must not depend on either.
 */
export type AiErrorCode =
  | 'AI_PROMPT_BUILD_FAILED'
  | 'AI_OUTPUT_INVALID'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'PROVIDER_KEY_MISSING';

export class AiError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = 'AiError';
    this.code = code;
  }
}

/** Minimal logger contract — `backend/src/lib/logger.ts` (pino) satisfies it structurally. */
export interface AiLogger {
  info(fields: Record<string, unknown>, event: string): void;
  warn(fields: Record<string, unknown>, event: string): void;
}

/** Default for callers that have no logger to give (unit tests, the odd script). */
export const noopLogger: AiLogger = {
  info: () => undefined,
  warn: () => undefined,
};
