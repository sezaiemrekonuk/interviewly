import { logger } from '../../src/lib/logger';

/**
 * Captures every `logger.<level>({ fields }, "EVENT_NAME")` the app makes during a
 * scenario, so "no log line contains the verification token" is an assertion over what the
 * code actually emitted rather than over a grep of the run's stdout.
 *
 * It wraps the shared pino instance in place instead of asking `logger.ts` for a test
 * hook: the production logger keeps exactly the shape it ships with, and nothing in
 * `src/` knows the acceptance ring exists.
 */

export interface CapturedLine {
  level: 'info' | 'warn' | 'error';
  event: string;
  fields: Record<string, unknown>;
}

const LEVELS = ['info', 'warn', 'error'] as const;

let lines: CapturedLine[] = [];

export function installLogSink(): void {
  for (const level of LEVELS) {
    const original = logger[level].bind(logger);
    // pino's signature is (obj, msg); every call site in this repo uses that order (K6).
    (logger as unknown as Record<string, unknown>)[level] = (
      fields: Record<string, unknown>,
      event: string,
    ) => {
      lines.push({ level, event, fields: fields ?? {} });
      original(fields, event);
    };
  }
}

export function resetLogSink(): void {
  lines = [];
}

export function capturedLines(): CapturedLine[] {
  return lines;
}

/** Every captured line flattened to one searchable string — fields included. */
export function capturedText(): string {
  return lines.map((l) => `${l.event} ${JSON.stringify(l.fields)}`).join('\n');
}
