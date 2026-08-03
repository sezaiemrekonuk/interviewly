/**
 * `POST /interviews/:id/answers` — the K2 progression step (§3.8, ADR-I06).
 *
 * One request does four things in order: guard that the answer targets the current question,
 * advance `current_index` atomically, write the turn, then hand the round over. The order is
 * the contract — the advance is what proves the caller won the race, so nothing is written
 * before it and the handover runs only for the caller that did.
 */
import type { InterviewState } from '@prisma/client';
import type { RequestHandler } from 'express';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { clock } from '../../src/lib/clock';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

import { BudgetExceeded, withBudget } from './budget';
import { ensureTechBatch } from './generation';
import { applyTransition } from './machine';
import { currentQuestionRow } from './state';

// A client-supplied `duration_ms` is accepted by the parser and dropped by it — Zod strips
// unknown keys, which is the whole handling this field gets (@AC-10 sends 999).
const bodySchema = z.object({
  questionId: z.string().min(1),
  transcript: z.string().trim().min(1).max(20_000),
  inputMode: z.enum(['voice', 'text', 'widget']),
});

export const submitAnswer: RequestHandler = async (req, res) => {
  const interview = req.interview!;
  const traceId = req.traceId!;

  if (interview.state !== 'hr_round' && interview.state !== 'tech_round') {
    throw new ApiError('INVALID_STATE_TRANSITION');
  }

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR');

  const expected = interview.current_index;
  const question = await currentQuestionRow(interview);
  // A body naming any question but the current one is the same rejection as losing the race,
  // and the response does not say which question it should have been.
  if (!question || question.id !== parsed.data.questionId) {
    throw new ApiError('QUESTION_NOT_CURRENT');
  }

  // ADR-I06: the advance IS the guard. Two requests can read the same `current_index`; the
  // WHERE clause lets exactly one of them write, and the loser changes nothing at all.
  const { count } = await prisma.interview.updateMany({
    where: { id: interview.id, current_index: expected },
    data: { current_index: expected + 1 },
  });
  if (count === 0) throw new ApiError('QUESTION_NOT_CURRENT');

  const answeredAt = clock.now();
  // Server clock, both ends: `asked_at` was stamped when state.ts delivered the question.
  const durationMs = question.asked_at
    ? answeredAt.getTime() - question.asked_at.getTime()
    : null;

  await prisma.$transaction([
    prisma.answer.create({
      data: {
        question_id: question.id,
        transcript: parsed.data.transcript,
        input_mode: parsed.data.inputMode,
        started_at: question.asked_at,
        answered_at: answeredAt,
        duration_ms: durationMs,
      },
    }),
    prisma.chatMessage.create({
      data: {
        interview_id: interview.id,
        role: 'user',
        content: parsed.data.transcript,
        trace_id: traceId,
      },
    }),
  ]);

  logger.info(
    { traceId, interviewId: interview.id, questionId: question.id, durationMs },
    'ANSWER_RECORDED',
  );

  const nextIndex = expected + 1;
  // ADR-I22: the technical batch is generated during the HR round, not by the transition into
  // it, so the handover is never a loading screen. Idempotent — every HR answer may call it.
  //
  // I08 mounts the ceiling here, after the turn is stored: @AC-11 keeps the answer that trips
  // it. An exhausted budget ends the interview rather than refusing this one call, because
  // every remaining turn — and the report — would cost too.
  if (interview.state === 'hr_round') {
    try {
      await withBudget(interview.id, () => ensureTechBatch(interview, { traceId }));
    } catch (err) {
      if (!(err instanceof BudgetExceeded)) throw err;
      logger.warn({ traceId, interviewId: interview.id }, 'BUDGET_EXHAUSTED');
      // ADR-I32: a losing transition must not replace the caller's error — the request is a
      // 402 whether or not this one is the request that moved the interview.
      try {
        await applyTransition(interview, 'evaluating', {
          traceId,
          endedReason: 'budget_exhausted',
        });
      } catch (transitionErr) {
        logger.error(
          { err: transitionErr, traceId, interviewId: interview.id },
          'INTERVIEW_END_FAILED',
        );
      }
      throw new ApiError('BUDGET_EXCEEDED');
    }
  }

  let state: InterviewState = interview.state;
  if (nextIndex > interview.target_question_count) {
    state = await applyTransition(interview, 'evaluating', { traceId });
  } else if (interview.state === 'hr_round' && nextIndex > interview.hr_question_count) {
    state = await applyTransition(interview, 'tech_round', { traceId });
  }

  res.status(200).json({ state, nextIndex });
};

export default submitAnswer;
