/**
 * R03, ADR-R04: what happens when a report job fails.
 *
 * Two failure branches converge on the interview state `failed` by different paths, and only
 * one of them is this file's:
 *
 * - **Schema gate (I09).** `runReport` transitions the interview `failed` itself and returns
 *   *without throwing*. The job completes on attempt 1 and is never retried — retrying it would
 *   buy three `llm_calls` rows to reproduce the same rejected payload. Nothing here runs.
 * - **Transient (this file).** A *thrown* error — provider chain exhausted, Postgres blip,
 *   storage down — fails the BullMQ job, which retries it under `REPORT_JOB_OPTIONS`. On the
 *   final failed attempt the interview is dead-lettered to `failed`.
 *
 * So the branch is read from the throw, not from the state: `handleReportJobFailed` is only ever
 * reached by a job that threw.
 */
import type { Job } from 'bullmq';
import { applyTransition, prisma, REPORT_JOB_OPTIONS } from '@interviewly/backend';

import { logger } from './lib/logger';

import type { ReportJobData } from './consumer';

/** `err.message` only — a provider error can quote the prompt, and K6 keeps that out of logs. */
const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * The exhaustion transition. Idempotent by way of `applyTransition`'s guard rather than by a
 * read-then-write check: if a racing retry already finished the interview (`completed`) or
 * another dead-letter beat this one to `failed`, the edge is illegal and the whole handler
 * becomes a no-op — including the `reports.status` write, which must not touch the `ready` row
 * the winning run left behind.
 */
export async function handleDeadLetter(interviewId: string, cause: unknown): Promise<void> {
  logger.error({ interviewId, reason: reasonOf(cause) }, 'REPORT_JOB_FAILED');

  // `deleted_at: null` for the same reason `runReport` filters on it: a candidate who deleted
  // the interview mid-flight does not get its state rewritten afterwards.
  const interview = await prisma.interview.findFirst({
    where: { id: interviewId, deleted_at: null },
  });
  if (!interview) {
    logger.warn({ interviewId }, 'REPORT_DEAD_LETTER_NOOP');
    return;
  }

  try {
    await applyTransition(interview, 'failed', { traceId: `worker-dead-letter-${interviewId}` });
  } catch (err) {
    if ((err as { code?: string })?.code !== 'INVALID_STATE_TRANSITION') throw err;
    logger.warn({ interviewId, state: interview.state }, 'REPORT_DEAD_LETTER_NOOP');
    return;
  }

  // `updateMany`, not `update`: I09 creates the row (already `ready`) inside its own transaction,
  // so the usual dead-letter has no row at all to mark — the interview state is the durable
  // signal there. `status: { not: 'ready' }` keeps a report that did land out of it.
  await prisma.report.updateMany({
    where: { interview_id: interviewId, status: { not: 'ready' } },
    data: { status: 'failed' },
  });

  logger.warn({ interviewId }, 'REPORT_DEAD_LETTERED');
}

/**
 * The `failed` listener body. BullMQ emits `failed` on *every* failed attempt, so the final one
 * has to be recognised: `attemptsMade` is incremented inside `moveToFailed` before the event
 * fires (bullmq 6), so it equals `opts.attempts` exactly once, on the attempt that exhausted it.
 *
 * Never rejects. An unhandled rejection out of an event listener takes the worker process down,
 * and a dead-letter that could not be written is an interview stuck in `evaluating` — loud, but
 * not fatal to the other queues in this process.
 */
export async function handleReportJobFailed(
  job: Job<ReportJobData> | undefined,
  err: Error,
): Promise<void> {
  const interviewId = job?.data?.interviewId;
  const attemptsMade = job?.attemptsMade ?? 0;
  const attempts = job?.opts?.attempts ?? REPORT_JOB_OPTIONS.attempts;

  if (!interviewId) {
    logger.error({ attemptsMade, reason: err.message }, 'REPORT_JOB_FAILED');
    return;
  }

  if (attemptsMade < attempts) {
    logger.warn({ interviewId, attemptsMade, reason: err.message }, 'REPORT_JOB_RETRY');
    return;
  }

  try {
    await handleDeadLetter(interviewId, err);
  } catch (deadLetterErr) {
    logger.error(
      { interviewId, reason: reasonOf(deadLetterErr) },
      'REPORT_DEAD_LETTER_FAILED',
    );
  }
}
