/**
 * `POST /interviews/:id/abandon` — the deliberate way out of the room (#104).
 *
 * Until this landed the only exits were the browser's back button and the worker's stale sweep,
 * which waits 24 hours. A candidate who stopped had no way to say so, and their history filled
 * with rows that read "in progress" until the next day.
 *
 * Leaving is not one transition, because a candidate who answered five questions and a
 * candidate who answered none have not done the same thing. The first has an interview worth
 * evaluating and goes through `evaluating`, which is the same path a completed interview takes
 * and therefore reuses the report job with no new machinery. The second has nothing to score,
 * and enqueueing a report over an empty transcript would spend a provider call to produce a
 * page saying so — that one ends at `abandoned` directly.
 *
 * Either way `ended_reason` is `abandoned`, which is what the history row and the report
 * header read to explain themselves.
 */
import type { InterviewState } from '@prisma/client';
import type { RequestHandler } from 'express';

import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

import { applyTransition } from './machine';

/**
 * The states a partial run can still be evaluated from.
 *
 * `paused` is deliberately not here even though a paused interview may hold answers: `paused`
 * has no `evaluating` edge, and adding one would put every `withBudgetOrEnd` caller that runs
 * against a paused interview — `POST /resume` — on a new path to `evaluating` that nothing in
 * this issue asked for. A paused interview is one whose generation failed, so it ends at
 * `abandoned` like the states below it. Give it the report path with the source that needs it.
 */
const REPORTABLE_FROM: ReadonlySet<InterviewState> = new Set<InterviewState>([
  'hr_round',
  'tech_round',
]);

export const abandonInterview: RequestHandler = async (req, res, next) => {
  try {
    const interview = req.interview!;
    const traceId = req.traceId!;

    // Rows, not `answered_at`: `recordAnswer` writes the timestamp in the same `create` as the
    // row, so an answer row that exists is an answer that was given. Counting the column
    // instead would only add a way for the two to disagree.
    const answered = REPORTABLE_FROM.has(interview.state)
      ? await prisma.answer.count({
          where: { question: { round: { interview_id: interview.id } } },
        })
      : 0;

    // `applyTransition` is left as the authority on legality — an interview in `created` or
    // already terminal answers 409 from there rather than from a second guard here that would
    // have to be kept in step with the table.
    const to: InterviewState = answered > 0 ? 'evaluating' : 'abandoned';
    const state = await applyTransition(interview, to, { traceId, endedReason: 'abandoned' });

    logger.info(
      { traceId, interviewId: interview.id, userId: req.user!.id, answered, to },
      'INTERVIEW_ABANDONED_BY_CANDIDATE',
    );

    res.status(200).json({ state });
  } catch (err) {
    next(err);
  }
};

export default abandonInterview;
