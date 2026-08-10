/**
 * `POST /interviews/:id/resume` — the `paused → hr_round` edge (§8.3, I07), and the only
 * repair for an interview left in `hr_round` with no batch to ask from, or parked in
 * `profiling` with no request left that can start it.
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
import { prisma } from '../../src/lib/db';

import { withBudgetOrEnd } from './budget';
import { generateRound } from './generation';
import { applyTransition } from './machine';
import { startHrRound } from './profile';

export const resumeInterview: RequestHandler = async (req, res) => {
  const interview = req.interview!;
  const ctx = { traceId: req.traceId! };

  // A room entered before the interview started is a dead end otherwise: `POST /profile` is the
  // only exit and only the setup screen calls it, so an interview that never got that call
  // (setup aborted, or history's Continue link) waits on a question nothing is generating.
  //
  // `created` is the same dead end one edge earlier. `POST /interviews` inserts the row and then
  // transitions it itself, so a request that died between the two leaves an interview nothing
  // can start — and history links to its room exactly like any other unfinished one (#89).
  if (interview.state === 'created' || interview.state === 'profiling') {
    if (interview.state === 'created') await applyTransition(interview, 'profiling', ctx);
    const state = await startHrRound(interview, interview.user_id, undefined, ctx);
    res.status(200).json({ state });
    return;
  }

  // The round the interview is sitting in is the round that can be missing its batch.
  const round: RoundType = interview.state === 'tech_round' ? 'tech' : 'hr';
  const questionCount = await prisma.question.count({
    where: { round: { interview_id: interview.id, type: round } },
  });

  // A round with an empty batch is the second door into the same repair. `POST /profile`
  // claims the transition before it generates, so a pause that could not be written
  // (`INTERVIEW_PAUSE_FAILED`) or a process that died between the two leaves an interview in a
  // round that has no question to ask and no request that can get it out — `/profile` refuses
  // anything but `profiling`, and the pause that would have made this endpoint legal is the
  // very write that failed. Recognising it here is the only recovery path there is.
  //
  // `tech_round` for the same reason one round over: the handover is driven by the answer whose
  // batch generation failed, so a pause that did not land leaves the interview in a technical
  // round with nothing in it. There is no `tech_round → paused` edge to catch it either.
  const stranded =
    (interview.state === 'hr_round' || interview.state === 'tech_round') && questionCount === 0;

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
  let state = stranded
    ? interview.state
    : await applyTransition(interview, 'hr_round', ctx);

  if (stranded) {
    try {
      // Under I08's ceiling like every other generation (issue #98): resume is a door back into
      // the same provider call, so it cannot be the one that spends past the budget.
      await withBudgetOrEnd(interview, () => generateRound(interview, round, ctx), ctx);
    } catch (err) {
      if ((err as { code?: string } | null)?.code !== 'P2002') throw err;
    }
  } else {
    // Which batch went missing depends on which generation gave out. ADR-I22 hangs the technical
    // one off an HR answer, so `current_index` — already advanced past the HR round by the answer
    // whose hook failed (I06 advances before the hook) — is what names the round the candidate is
    // actually waiting on. `generateRound` is a no-op when that round is already full, so a pause
    // the candidate can simply answer through resumes without spending an LLM call.
    const roundType: RoundType =
      interview.current_index > interview.hr_question_count ? 'tech' : 'hr';

    // Deliberately not caught: a provider still down re-pauses through the same
    // `hr_round → paused` edge, which puts the Resume button back rather than consuming the one
    // recovery the room has. An exhausted budget is the other outcome, and it ends the
    // interview instead — there is no round left to resume into.
    await withBudgetOrEnd(interview, () => generateRound(interview, roundType, ctx), ctx);

    // If the index is already in the technical round, return the interview to `tech_round` so the
    // room's active persona matches the question being served.
    if (roundType === 'tech') {
      state = await applyTransition(interview, 'tech_round', ctx);
    }
  }

  res.status(200).json({ state });
};

export default resumeInterview;
