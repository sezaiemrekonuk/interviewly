/**
 * `POST /interviews/:id/resume` — the `paused → hr_round` edge (§8.3, I07).
 *
 * Pause discards nothing: every answer and question recorded before the provider gave out is
 * still there, so resuming is a state change and nothing else.
 */
import type { RequestHandler } from 'express';

import { ApiError } from '../../src/lib/api-error';

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
  res.status(200).json({ state });
};

export default resumeInterview;
