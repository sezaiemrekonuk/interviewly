/**
 * `POST /webhooks/elevenlabs/:action` — the three in-round voice tool calls (V02).
 *
 * Mounted without `requireAuth` (server-to-server, no cookie) and without `requirePublicOrigin`
 * (there is no browser origin to check). `runGates` is the authentication, and it runs to
 * completion before any handler touches the interview: §7.1 item 4 — a voice tool call holds no
 * authority a schema and state check does not grant.
 */
import { Router, type RequestHandler } from 'express';

import type { Interview } from '@prisma/client';

import { ApiError } from '../../src/lib/api-error';
import { logger } from '../../src/lib/logger';

import { advanceWithAnswer, answerInputSchema } from '../interview/answers';
import { applyTransition } from '../interview/machine';
import { currentQuestionRow, deliverCurrentQuestion } from '../interview/state';

import { consumeSession, isPastCeiling, runGates } from './webhook-auth';

const ACTIONS = new Set(['submit_answer', 'next_question', 'end_round']);

/** The last global index belonging to the round the interview is currently in (K2). */
function roundLastIndex(interview: Interview): number {
  return interview.state === 'hr_round'
    ? interview.hr_question_count
    : interview.target_question_count;
}

export const handleVoiceWebhook: RequestHandler = async (req, res) => {
  const action = String(req.params.action);
  const traceId = req.traceId!;

  // Logged before gate 1 rather than after it, because @AC-3 asserts a rejected webhook emits
  // its code WITH the interviewId — and after a failed signature the body is untrusted input,
  // so this id is an identifier for correlation only. It is never a secret; the nonce is.
  const claimedId = typeof req.body?.interviewId === 'string' ? req.body.interviewId : undefined;

  if (!ACTIONS.has(action)) throw new ApiError('VALIDATION_ERROR');

  let ctx;
  try {
    ctx = await runGates(req);
  } catch (err) {
    if (err instanceof ApiError) {
      logger.warn({ traceId, interviewId: claimedId }, err.code);
    }
    throw err;
  }

  const { interview, session } = ctx;
  logger.info({ traceId, interviewId: interview.id, action }, 'VOICE_WEBHOOK_RECEIVED');

  // Gate 4, clock half. The ceiling ends the interview rather than merely refusing the call:
  // every later turn would be past it too (§7.3). The transition is I07's — nothing here
  // writes `interviews.state`.
  if (isPastCeiling(session)) {
    await consumeSession(session);
    await applyTransition(interview, 'evaluating', { traceId, endedReason: 'time_exhausted' });
    logger.warn({ traceId, interviewId: interview.id }, 'VOICE_TIME_EXHAUSTED');
    throw new ApiError('VOICE_SESSION_EXPIRED');
  }

  // Gate 4, legality half — per action, all of it delegated to I06/I07.
  switch (action) {
    case 'submit_answer': {
      const question = await currentQuestionRow(interview);
      if (!question) throw new ApiError('INVALID_STATE_TRANSITION');
      // `advanceWithAnswer` takes parsed input, and `req.body.transcript` is untrusted `any`
      // off the wire — parsing here is what keeps the agent's transcript inside the same
      // length/shape bounds the HTTP route enforces (§7.1 item 4).
      const parsed = answerInputSchema.safeParse({
        questionId: question.id,
        transcript: req.body?.transcript,
        inputMode: 'voice',
      });
      if (!parsed.success) throw new ApiError('VALIDATION_ERROR');
      const result = await advanceWithAnswer(interview, parsed.data, { traceId });
      res.status(200).json(result);
      return;
    }

    case 'next_question': {
      // `current_index` already advanced on the answer; "next" is what it points at now.
      const question = await deliverCurrentQuestion(interview);
      if (!question) throw new ApiError('INVALID_STATE_TRANSITION');
      res.status(200).json({ questionId: question.id, text: question.text });
      return;
    }

    case 'end_round': {
      // The agent may ask to close a round; it may not decide the round is over. Only an
      // exhausted index earns the transition — @AC-5 posts this one question early and gets 409.
      //
      // ponytail: an explicit shortening decision (§3.8) has no column yet — adaptive D03 owns
      // it. Read it here as a second legal trigger once it exists.
      if (interview.current_index <= roundLastIndex(interview)) {
        throw new ApiError('INVALID_STATE_TRANSITION');
      }
      const to =
        interview.state === 'hr_round' && interview.current_index <= interview.target_question_count
          ? 'tech_round'
          : 'evaluating';
      const state = await applyTransition(interview, to, { traceId });
      await consumeSession(session);
      res.status(200).json({ state });
      return;
    }
  }
};

const router = Router();
router.post('/:action', handleVoiceWebhook);

export default router;
