import { applyTransition, prisma } from '@interviewly/backend';
import type { Interview, InterviewState } from '@prisma/client';

import { logger } from '../lib/logger';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const SWEEP_STATES: InterviewState[] = ['profiling', 'hr_round', 'paused'];
// `take` bounds the transitions one tick performs, not the rows it reads: the staleness
// predicate is in the WHERE clause below, so the database returns stale rows only. A swept row
// leaves `SWEEP_STATES`, so the next tick continues where this one stopped.
const SWEEP_BATCH_LIMIT = 500;

// `applyTransition` takes an `Interview` but reads only `id`/`state`/`ended_at` and writes back
// `state`, `ended_reason` and `ended_at` — the columns selected here. Selecting the whole row
// instead would drag `job_text` and `candidate_profile` along for every candidate on every tick.
// `ended_at` earns its place because the transition will not re-stamp a row that already has
// one, and an absent column here would read as "never ended".
type SweepCandidate = Pick<Interview, 'id' | 'state' | 'ended_reason' | 'ended_at'>;

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

function invalidTransition(cause: unknown): boolean {
  return (cause as { code?: string })?.code === 'INVALID_STATE_TRANSITION';
}

export async function sweepAbandoned(): Promise<void> {
  const nowMs = Date.now();
  // `interviews` has no `updated_at`, so last activity is the most recent of the last answered
  // turn, `started_at` and `created_at`. `max(a, b, c) < cutoff` is the same predicate as
  // `a < cutoff AND b < cutoff AND c < cutoff`, which is expressible in SQL — so the filter
  // rides in the query rather than being applied to every candidate row in this process.
  const cutoff = new Date(nowMs - STALE_AFTER_MS);
  const candidates: SweepCandidate[] = await prisma.interview.findMany({
    where: {
      deleted_at: null,
      state: { in: SWEEP_STATES },
      created_at: { lt: cutoff },
      // `null` is not "recent" — an interview that never started is as stale as its creation.
      OR: [{ started_at: null }, { started_at: { lt: cutoff } }],
      // Vacuously true when the interview has no messages at all, which is the fallback case.
      chat_messages: { none: { created_at: { gte: cutoff } } },
    },
    select: {
      id: true,
      state: true,
      ended_reason: true,
      ended_at: true,
    },
    orderBy: { created_at: 'asc' },
    take: SWEEP_BATCH_LIMIT,
  });

  let swept = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    // Read before the call: `applyTransition` writes `state` back onto the object it is given,
    // so `candidate.state` is already `abandoned` by the time the success log runs.
    const from = candidate.state;
    try {
      await applyTransition(candidate as Interview, 'abandoned', {
        traceId: `worker-abandon-${candidate.id}-${nowMs}`,
        endedReason: 'abandoned',
      });
      swept += 1;
      logger.info({ interviewId: candidate.id, from }, 'INTERVIEW_ABANDONED');
    } catch (err) {
      if (invalidTransition(err)) {
        skipped += 1;
        logger.warn({ interviewId: candidate.id, from }, 'INTERVIEW_ABANDON_SKIP');
        continue;
      }

      failed += 1;
      logger.error(
        { interviewId: candidate.id, from, reason: reasonOf(err) },
        'INTERVIEW_ABANDON_FAILED',
      );
    }
  }

  logger.info(
    {
      stale: candidates.length,
      swept,
      skipped,
      failed,
      // A full batch means stale rows were left for the next tick — say so rather than let the
      // summary read as "the table is clean".
      truncated: candidates.length === SWEEP_BATCH_LIMIT,
    },
    'INTERVIEW_ABANDON_SWEEP_COMPLETED',
  );
}
