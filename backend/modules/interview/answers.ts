/**
 * `POST /interviews/:id/answers` — the K2 progression step (§3.8, ADR-I06).
 *
 * One request does four things in order: guard that the answer targets the current question,
 * advance `current_index` and write the turn in one transaction, then hand the round over.
 * The order is the contract — the advance is what proves the caller won the race, so nothing
 * is written before it and the handover runs only for the caller that did.
 */
import type { Interview, InterviewState } from '@prisma/client';
import type { AiClient } from '@interviewly/ai';
import type { RequestHandler } from 'express';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { clock } from '../../src/lib/clock';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

import { promoteNextQuestion } from './adaptive';
import { BudgetExceeded, withBudget, withBudgetOrEnd } from './budget';
import { ensureTechBatch } from './generation';
import { trackLanguage } from './language';
import { applyTransition } from './machine';
import { currentQuestionRow } from './state';

// A client-supplied `duration_ms` is accepted by the parser and dropped by it — Zod strips
// unknown keys, which is the whole handling this field gets (@AC-10 sends 999).
// Exported because `advanceWithAnswer` takes PARSED input: every caller must run this first,
// and S03's audio route hands it an untrusted provider transcript (§7.1 item 4). A second
// schema there would be a second thing to drift.
export const answerInputSchema = z.object({
  questionId: z.string().min(1),
  transcript: z.string().trim().min(1).max(20_000),
  inputMode: z.enum(['voice', 'text', 'widget']),
});

type AnswerInput = z.infer<typeof answerInputSchema>;

/**
 * Core answer-progression logic, shared by the typed handler and S03's audio route.
 * Validates state, advances `current_index` atomically, records the turn, and runs all
 * post-answer side-effects.
 */
export async function advanceWithAnswer(
  interview: Interview,
  data: AnswerInput,
  opts: { traceId: string; client?: AiClient },
): Promise<{ state: InterviewState; nextIndex: number }> {
  const { traceId } = opts;

  if (interview.state !== 'hr_round' && interview.state !== 'tech_round') {
    throw new ApiError('INVALID_STATE_TRANSITION');
  }

  const expected = interview.current_index;
  const question = await currentQuestionRow(interview);
  // A body naming any question but the current one is the same rejection as losing the race,
  // and the response does not say which question it should have been.
  if (!question || question.id !== data.questionId) {
    throw new ApiError('QUESTION_NOT_CURRENT');
  }

  const answeredAt = clock.now();
  // Server clock, both ends: `asked_at` was stamped when state.ts delivered the question.
  const durationMs = question.asked_at
    ? answeredAt.getTime() - question.asked_at.getTime()
    : null;

  // The advance and the turn are ONE commit (#70). Split across two, a crash in between left
  // `current_index` moved with no answer row — and the CAS below then refused the resubmit,
  // so the answer was unrecoverable.
  //
  // ADR-I06 is unchanged by the move: the advance is still the guard. Two requests can read
  // the same `current_index`, the WHERE clause still lets exactly one of them write, and the
  // loser now rolls back instead of merely returning early.
  const answer = await prisma.$transaction(async (tx) => {
    const { count } = await tx.interview.updateMany({
      where: { id: interview.id, current_index: expected },
      data: { current_index: expected + 1 },
    });
    if (count === 0) throw new ApiError('QUESTION_NOT_CURRENT');

    const created = await tx.answer.create({
      data: {
        question_id: question.id,
        transcript: data.transcript,
        input_mode: data.inputMode,
        started_at: question.asked_at,
        answered_at: answeredAt,
        duration_ms: durationMs,
      },
    });
    await tx.chatMessage.create({
      data: {
        interview_id: interview.id,
        role: 'user',
        content: data.transcript,
        trace_id: traceId,
      },
    });
    return created;
  });

  logger.info(
    { traceId, interviewId: interview.id, questionId: question.id, durationMs },
    'ANSWER_RECORDED',
  );

  // I10: a pure heuristic, no `llm_calls` row. It runs before the handover below because a
  // switch has to reach the technical batch that ADR-I22 generates in `interview.language`.
  //
  // It also runs before the K4 hook, and the hook reads `interview.language` off this
  // assignment: the candidate pool D02 generates for the next row is written in the language
  // the switch just landed on, so no pool is ever stale enough to need a refresh (#148).
  const nextIndex = expected + 1;
  interview.language = await trackLanguage(interview, data.transcript, { traceId });

  // ADR-I22: the technical batch is generated during the HR round, not by the transition into
  // it, so the handover is never a loading screen. Idempotent — every HR answer may call it.
  //
  // I08 mounts the ceiling here, after the turn is stored: @AC-11 keeps the answer that trips
  // it. An exhausted budget ends the interview rather than refusing this one call, because
  // every remaining turn — and the report — would cost too.
  if (interview.state === 'hr_round') {
    try {
      await withBudgetOrEnd(interview, () => ensureTechBatch(interview, { traceId }), { traceId });
    } catch (err) {
      // The same principle the K4 hook below is already written to: a failure here must not
      // fail the answer, which was stored two statements ago (#90). A provider outage used to
      // answer 503 to a request that had succeeded at its primary job, so the candidate was
      // told their answer was lost while `generation.ts` had already paused the interview —
      // the room then showed an inline error instead of the paused block, and pressing Send
      // again 409'd against the pause.
      //
      // `BUDGET_EXCEEDED` keeps its 402. It is not a failed side-effect but the end of the
      // interview (@AC-11 keeps this answer, I08 ends the rest), and the room routes the code
      // to a silent refetch that lands on the ended state.
      if (err instanceof ApiError && err.code === 'BUDGET_EXCEEDED') throw err;
      logger.warn({ err, traceId, interviewId: interview.id }, 'TECH_BATCH_FAILED');
    }
  }

  let state: InterviewState = interview.state;
  // Only from a round. A batch that failed has already paused the interview, and `paused` has
  // no handover edge — attempting one would replace a recorded answer with a 409.
  if (state === 'hr_round' || state === 'tech_round') {
    if (nextIndex > interview.target_question_count) {
      state = await applyTransition(interview, 'evaluating', { traceId });
    } else if (state === 'hr_round' && nextIndex > interview.hr_question_count) {
      state = await applyTransition(interview, 'tech_round', { traceId });
    }
  }

  // K4 (ADR-D03): additive adaptive hook. A failure here must not fail the answer — the
  // default next row is a working MVP question, so a scoring/generation hiccup degrades to it.
  //
  // Under I08's ceiling, unlike the tech batch above: the hook spends on every turn, so an
  // interview that has exhausted its budget would otherwise keep billing two provider calls
  // per answer for the rest of the round. `BudgetExceeded` here is not the 402 the batch
  // raises — the turn is already stored and the default next question is askable, so the
  // interview drops to non-adaptive rather than ending.
  try {
    await withBudget(interview.id, () =>
      promoteNextQuestion(interview, question, answer.id, data.transcript, nextIndex, {
        traceId,
        client: opts.client,
      }),
    );
  } catch (err) {
    if (err instanceof BudgetExceeded) {
      logger.warn({ traceId, interviewId: interview.id }, 'ADAPTIVE_SKIPPED_NO_BUDGET');
    } else {
      logger.warn({ err, traceId, interviewId: interview.id }, 'ADAPTIVE_HOOK_FAILED');
    }
  }

  return { state, nextIndex };
}

export const submitAnswer: RequestHandler = async (req, res) => {
  const interview = req.interview!;
  const traceId = req.traceId!;

  const parsed = answerInputSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR');

  const result = await advanceWithAnswer(interview, parsed.data, { traceId });
  res.status(200).json(result);
};

export default submitAnswer;
