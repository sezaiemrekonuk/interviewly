/**
 * `POST /interviews/:id/resume` — the `paused → hr_round` edge (§8.3, I07).
 *
 * Pause discards nothing: every answer and question recorded before the provider gave out is
 * still there, so resuming is a state change and nothing else.
 */
import type { RequestHandler } from 'express';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';

import { generateRound } from './generation';
import { applyTransition } from './machine';

export const resumeInterview: RequestHandler = async (req, res) => {
  const interview = req.interview!;

  // `applyTransition` alone would let `hr_round → tech_round` through, which is a legal edge
  // driven by the last HR answer and not by this endpoint.
  if (interview.state !== 'paused') throw new ApiError('INVALID_STATE_TRANSITION');

  // The round it left is `hr_round` by construction — ADR-I22 generates both batches during
  // the HR round, so that is the only state a failed generation can pause. When a second
  // pause source lands, this reads the round back instead of naming it.
  const state = await applyTransition(interview, 'hr_round', { traceId: req.traceId! });

  // Issue 65: a pause can land here with zero HR questions — the failed generation that
  // caused it never inserted any. Regenerating is idempotent (mirrors `ensureTechBatch`), so
  // a resume after a genuine provider outage, where the HR batch already exists, does not
  // spend a second LLM call. A failure here re-pauses via `generateRound`'s own guard.
  const hrQuestionCount = await prisma.question.count({
    where: { round: { interview_id: interview.id, type: 'hr' } },
  });
  if (hrQuestionCount === 0) {
    await generateRound(interview, 'hr', { traceId: req.traceId! });
  }

  res.status(200).json({ state });
};

export default resumeInterview;
