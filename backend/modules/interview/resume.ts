/**
 * `POST /interviews/:id/resume` — the `paused → hr_round` edge (§8.3, I07).
 *
 * Resume is not a state change and nothing else. The only thing that pauses an interview is a
 * generation that failed, and `generateRound` inserts all-or-nothing *after* the provider call —
 * so a paused interview is always missing the batch that pause was about. Flipping the state
 * without redoing that work hands the candidate a room with no question and no button left to
 * press, which is worse than the pause it cleared.
 */
import type { RoundType } from '@interviewly/ai';
import type { RequestHandler } from 'express';

import { ApiError } from '../../src/lib/api-error';

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
  //
  // Claimed BEFORE the generation below, the same way `POST /profile` does it: the WHERE-guarded
  // update is what makes two concurrent resumes into one generation and one 409, and a state
  // change published while the batch is still being written costs nothing here — the mutation's
  // own refetch runs on this response, which lands after the questions exist.
  let state = await applyTransition(interview, 'hr_round', { traceId: req.traceId! });

  // Which batch went missing depends on which generation gave out. ADR-I22 hangs the technical
  // one off an HR answer, so `current_index` — already advanced past the HR round by the answer
  // whose hook failed (I06 advances before the hook) — is what names the round the candidate is
  // actually waiting on. `generateRound` is a no-op when that round is already full, so a pause
  // the candidate can simply answer through resumes without spending an LLM call.
  const roundType: RoundType =
    interview.current_index > interview.hr_question_count ? 'tech' : 'hr';

  // Deliberately not caught: a provider still down re-pauses through the same `hr_round → paused`
  // edge, which puts the Resume button back rather than consuming the one recovery the room has.
  await generateRound(interview, roundType, { traceId: req.traceId! });

  // If the index is already in the technical round, return the interview to `tech_round` so the
  // room's active persona matches the question being served.
  if (roundType === 'tech') {
    state = await applyTransition(interview, 'tech_round', { traceId: req.traceId! });
  }

  res.status(200).json({ state });
};

export default resumeInterview;
