/**
 * D03 — the K4 adaptive hook (ADR-D03). Additive over I06's answer handler: score the answer,
 * select the next move (D01), and promote one of the next row's pre-generated candidates (D02).
 *
 * The invariant lives here: a score that fails `ScoresSchema` never promotes a graded row. The
 * raw score is handed to `selectNextQuestion` unparsed — the selector owns the validation, so a
 * malformed score flows through as data (the `fallback` branch), never as a thrown 500. Remove
 * this call from `answers.ts` and the default I06 next row remains: a working MVP interview.
 */
import type { Interview, Question } from '@prisma/client';
import { CandidateSchema, type AiClient, type AiCtx, type Candidate } from '@interviewly/ai';
import { z } from 'zod';

import { aiClient } from '../ai';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

import { selectNextQuestion, type AdaptiveSelection } from './adaptive-select';
import { currentQuestionRow } from './state';

const CandidatesSchema = z.array(CandidateSchema);

/**
 * Runs after I06's advance. `answered` is the row the turn answered; `nextIndex` is the global
 * index the interview now points at (I06's pre-advance `interview.current_index` is untouched,
 * so `currentQuestionRow` is asked for `nextIndex` explicitly).
 */
export async function promoteNextQuestion(
  interview: Interview,
  answered: Pick<Question, 'id' | 'text' | 'difficulty' | 'topic'>,
  answerId: string,
  transcript: string,
  nextIndex: number,
  opts: { traceId: string; client?: AiClient },
): Promise<void> {
  const { traceId } = opts;
  const ctx: AiCtx = { interviewId: interview.id, traceId };

  const nextRow = await currentQuestionRow({
    id: interview.id,
    hr_question_count: interview.hr_question_count,
    current_index: nextIndex,
  });
  if (!nextRow) return; // no unasked row — the interview is ending, nothing to adapt.
  if (nextRow.chosen_reason) return; // §3.8: a resume/refresh must not re-score this turn.

  // Gated on D02's pre-generated candidates (task step 1, IDEA §3.7). An MVP interview never
  // pre-generates, so the hook is a no-op for it — no score, no LLM call, no promotion. This
  // is what keeps K4 from breaking the MVP ledger (an answer submit stays call-free).
  const candidates = CandidatesSchema.safeParse(nextRow.candidates);
  if (!candidates.success) return;

  const client = opts.client ?? aiClient();
  const raw = await client.scoreAnswer({
    question: answered.text,
    transcript,
    candidateProfile: null,
    language: interview.language,
    ctx,
  });
  const move = selectNextQuestion(raw, { difficulty: answered.difficulty, topic: answered.topic });

  if (!move.graded) {
    await prisma.question.update({ where: { id: nextRow.id }, data: { chosen_reason: 'fallback' } });
    logger.warn({ traceId, interviewId: interview.id, questionId: nextRow.id }, 'LLM_FALLBACK_TRIGGERED');
    return;
  }

  const cand = pickCandidate(candidates.data, move, answered.topic);
  if (!cand) {
    // Graded, but nothing to promote — keep the default row (a valid MVP question). The score
    // is still recorded: the report ledger reads answers.scores.
    await prisma.answer.update({ where: { id: answerId }, data: { scores: raw } });
    return;
  }

  await prisma.$transaction([
    prisma.answer.update({ where: { id: answerId }, data: { scores: raw } }),
    prisma.question.update({
      where: { id: nextRow.id },
      data: {
        text: cand.text,
        difficulty: move.difficulty,
        topic: cand.topic,
        chosen_reason: move.chosenReason,
      },
    }),
  ]);
  logger.info(
    { traceId, interviewId: interview.id, questionId: nextRow.id, chosenReason: move.chosenReason },
    'ADAPTIVE_QUESTION_PROMOTED',
  );
}

/** Match by the selector's difficulty first, then whether the topic moves (new vs same). */
function pickCandidate(
  candidates: Candidate[],
  move: Extract<AdaptiveSelection, { graded: true }>,
  currentTopic: string,
): Candidate | undefined {
  const wantSameTopic = move.topicMove === 'same';
  return candidates.find(
    (c) => c.difficulty === move.difficulty && (c.topic === currentTopic) === wantSameTopic,
  );
}
