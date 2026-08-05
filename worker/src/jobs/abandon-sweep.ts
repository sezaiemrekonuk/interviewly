import { applyTransition, prisma } from '@interviewly/backend';
import type { Interview, InterviewState } from '@prisma/client';

import { logger } from '../lib/logger';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const SWEEP_STATES: InterviewState[] = ['profiling', 'hr_round', 'paused'];
// The staleness predicate cannot be pushed into the WHERE clause (there is no `updated_at`;
// it is derived from `chat_messages`/`started_at`/`created_at`), so every candidate row is
// loaded before it can be judged. Bounded so one sweep cannot pull the whole state index into
// memory; a swept row leaves `SWEEP_STATES`, so the next tick continues where this one stopped.
const SWEEP_BATCH_LIMIT = 500;

// `applyTransition` takes an `Interview` but reads only `id`/`state` and writes back `state`
// and `ended_reason` — the columns selected here. Selecting the whole row instead would drag
// `job_text` and `candidate_profile` along for every candidate on every tick.
type SweepCandidate = Pick<Interview, 'id' | 'state' | 'started_at' | 'created_at' | 'ended_reason'>;

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

function newest(dates: Array<Date | null | undefined>): Date {
  const timestamps = dates
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.getTime());
  return new Date(Math.max(...timestamps));
}

function stale(nowMs: number, lastActivity: Date): boolean {
  return nowMs - lastActivity.getTime() > STALE_AFTER_MS;
}

function invalidTransition(cause: unknown): boolean {
  return (cause as { code?: string })?.code === 'INVALID_STATE_TRANSITION';
}

export async function sweepAbandoned(): Promise<void> {
  const nowMs = Date.now();
  const candidates: SweepCandidate[] = await prisma.interview.findMany({
    where: {
      deleted_at: null,
      state: { in: SWEEP_STATES },
    },
    select: {
      id: true,
      state: true,
      started_at: true,
      created_at: true,
      ended_reason: true,
    },
    orderBy: { created_at: 'asc' },
    take: SWEEP_BATCH_LIMIT,
  });

  if (candidates.length === 0) {
    logger.info(
      { candidates: 0, stale: 0, swept: 0, skipped: 0, failed: 0 },
      'INTERVIEW_ABANDON_SWEEP_COMPLETED',
    );
    return;
  }

  const rows = await prisma.chatMessage.groupBy({
    by: ['interview_id'],
    where: { interview_id: { in: candidates.map((candidate) => candidate.id) } },
    _max: { created_at: true },
  });
  const lastMessageByInterview = new Map(
    rows.map((row) => [row.interview_id, row._max.created_at ?? null]),
  );

  let staleCount = 0;
  let swept = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const lastActivity = newest([
      candidate.created_at,
      candidate.started_at,
      lastMessageByInterview.get(candidate.id),
    ]);
    if (!stale(nowMs, lastActivity)) continue;

    staleCount += 1;
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
      candidates: candidates.length,
      stale: staleCount,
      swept,
      skipped,
      failed,
      // A full batch means rows were left for the next tick — say so rather than let the
      // summary read as "the table is clean".
      truncated: candidates.length === SWEEP_BATCH_LIMIT,
    },
    'INTERVIEW_ABANDON_SWEEP_COMPLETED',
  );
}
