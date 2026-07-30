import { ERROR_CODES, type ErrorCode } from './error-codes';

// Thrown anywhere in a handler; the app's error middleware maps `.code` to the
// registry's HTTP status and returns `{ error: { code } }`. The API never returns
// display strings — stable codes only.
export class ApiError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(code);
    this.name = 'ApiError';
  }
}

export function httpStatusFor(code: ErrorCode): number {
  return ERROR_CODES[code].http ?? 500;
}
