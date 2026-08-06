/**
 * `POST /interviews/:id/resume` — the `paused → hr_round` edge (§8.3, I07), and the only
 * repair for an interview left in `hr_round` with no batch to ask from.
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

  const hrQuestionCount = await prisma.question.count({
    where: { round: { interview_id: interview.id, type: 'hr' } },
  });

  // `hr_round` with an empty batch is the second door into the same repair. `POST /profile`
  // claims the transition before it generates, so a pause that could not be written
  // (`INTERVIEW_PAUSE_FAILED`) or a process that died between the two leaves an interview in a
  // round that has no question to ask and no request that can get it out — `/profile` refuses
  // anything but `profiling`, and the pause that would have made this endpoint legal is the
  // very write that failed. Recognising it here is the only recovery path there is.
  const stranded = interview.state === 'hr_round' && hrQuestionCount === 0;

  // `applyTransition` alone would let `hr_round → tech_round` through, which is a legal edge
  // driven by the last HR answer and not by this endpoint.
  if (interview.state !== 'paused' && !stranded) throw new ApiError('INVALID_STATE_TRANSITION');

  // The round it left is `hr_round` by construction — ADR-I22 generates both batches during
  // the HR round, so that is the only state a failed generation can pause. When a second
  // pause source lands, this reads the round back instead of naming it. The stranded interview
  // is already there, and re-entering the state it holds is not an edge the machine models.
  //
  // That also means concurrent stranded resumes are not serialised by the state guard the way
  // the `paused` path is; `questions(round_id, order_index)` is unique, so the loser of the
  // race fails its insert rather than doubling the batch.
  const state = stranded
    ? interview.state
    : await applyTransition(interview, 'hr_round', { traceId: req.traceId! });

if (hrQuestionCount === 0) {
  try {
    await generateRound(interview, 'hr', { traceId: req.traceId! });
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== 'P2002') throw err;
  }
}

  res.status(200).json({ state });
};

export default resumeInterview;
