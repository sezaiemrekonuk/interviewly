/**
 * The K2 transition guard (§8.3, ADR-I07). Complete as of I07.
 *
 * Every state change goes through `applyTransition`, so `INTERVIEW_STATE_CHANGED` cannot be
 * emitted without the edge having been checked, and an unlisted edge is a 409 rather than a
 * silently written column. Nothing else in the codebase writes `interviews.state`.
 */
import type { Interview, InterviewState } from '@prisma/client';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

import { enqueueReport, publishStateChanged } from './sse';

const TRANSITIONS: Partial<Record<InterviewState, InterviewState[]>> = {
  created: ['profiling'],
  profiling: ['hr_round'],
  // `hr_round → evaluating` is not a shortcut: the split can leave a short interview with
  // zero technical questions (target 2 → hr 2, tech 0), and that interview still ends. I08
  // attaches its budget-exhaustion edge to the same two targets.
  hr_round: ['tech_round', 'evaluating', 'paused'],
  tech_round: ['evaluating'],
  // No `tech_round → paused`: the only pause source is a failed generation, and ADR-I22 puts
  // both batches inside the HR round. Add the edge with the source that needs it.
  paused: ['hr_round'],
  evaluating: ['completed', 'failed'],
};

export function canTransition(from: InterviewState, to: InterviewState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export async function applyTransition(
  interview: Interview,
  to: InterviewState,
  ctx: { traceId: string },
): Promise<InterviewState> {
  const from = interview.state;
  if (!canTransition(from, to)) throw new ApiError('INVALID_STATE_TRANSITION');

  // ADR-I06's pattern, applied to the state column: `from` was read when the request resolved
  // its interview, so checking the table against it is a TOCTOU. The WHERE clause re-checks it
  // at write time, which is what makes the guard hold across concurrent requests and replicas.
  const { count } = await prisma.interview.updateMany({
    where: { id: interview.id, state: from },
    data: { state: to },
  });
  if (count === 0) throw new ApiError('INVALID_STATE_TRANSITION');

  // The caller's copy is now stale, and a request that transitions twice (`POST /profile`
  // moves to `hr_round`, then a failed generation pauses it) would re-read the old `from`.
  interview.state = to;

  logger.info(
    { traceId: ctx.traceId, interviewId: interview.id, from, to },
    'INTERVIEW_STATE_CHANGED',
  );

  // Best-effort, and deliberately not symmetric with `enqueueReport` below. The fan-out is a
  // push optimisation — a room that misses an event still reconstructs from `GET /state` — so
  // a Redis outage must not turn a committed transition into a failed request, or mask the
  // `AI_PROVIDER_UNAVAILABLE` that caused the pause in the first place.
  try {
    await publishStateChanged({ from, to, interviewId: interview.id });
  } catch (err) {
    logger.error(
      { err, traceId: ctx.traceId, interviewId: interview.id, from, to },
      'INTERVIEW_EVENT_PUBLISH_FAILED',
    );
  }

  // NOT wrapped: once R01 makes this a real BullMQ enqueue, a swallowed failure is an
  // interview that reaches `evaluating` and never gets a report. That has to be loud.
  if (to === 'evaluating') enqueueReport(interview.id, ctx);

  return to;
}
