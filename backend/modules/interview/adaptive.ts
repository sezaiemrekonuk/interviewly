/**
 * D03 — the K4 adaptive hook (ADR-D03). Additive over I06's answer handler: generate the next
 * row's candidate pool (D02), score the answer, select the next move (D01), and promote one of
 * the candidates into the row.
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
import { prepareNextCandidates } from './candidate-prep';
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

  const client = opts.client ?? aiClient();

  // D02 runs here rather than on a turn of its own. It used to be a precondition — no pool,
  // no promotion — and nothing ever wrote the first pool, so the whole hook was unreachable
  // (#148). Producing it is now part of the hook: the row promoted this turn is the row
  // generated this turn.
  //
  // Concurrent with the score because the two calls share no input, so the answer response
  // waits for one provider round-trip and not two. A pool already on the row is reused — a
  // resume that re-enters the hook must not pay for a second generation.
  const existing = CandidatesSchema.safeParse(nextRow.candidates);
  const candidatesPromise = existing.success
    ? Promise.resolve(existing.data)
    : prepareNextCandidates({
        interview,
        nextQuestionId: nextRow.id,
        currentQuestion: answered,
        ctx,
        client: opts.client,
      }).catch((err: unknown) => {
        // Degrade to score-only: the default next row is a working MVP question, and the
        // score still reaches the report. Rethrowing would cost the score too.
        logger.warn(
          { err, traceId, interviewId: interview.id, questionId: nextRow.id },
          'CANDIDATE_PREGENERATION_FAILED',
        );
        return [] as Candidate[];
      });

  const [raw, candidates] = await Promise.all([
    client.scoreAnswer({
      question: answered.text,
      transcript,
      candidateProfile: null,
      language: interview.language,
      ctx,
    }),
    candidatesPromise,
  ]);

  const move = selectNextQuestion(raw, { difficulty: answered.difficulty, topic: answered.topic });

  if (!move.graded) {
    await prisma.question.update({ where: { id: nextRow.id }, data: { chosen_reason: 'fallback' } });
    logger.warn({ traceId, interviewId: interview.id, questionId: nextRow.id }, 'LLM_FALLBACK_TRIGGERED');
    return;
  }

  const cand = pickCandidate(candidates, move, answered.topic);
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

/**
 * Difficulty is the axis the selector actually decided, so it is the one that must be honoured;
 * the topic move is a preference among candidates that already match it.
 *
 * The fallback is not politeness, it is what keeps promotion working on real pools. A
 * candidate's `topic` is a label the model wrote, and `interview.question.candidates` is never
 * told the current question's topic — so `c.topic === currentTopic` is a string coincidence,
 * not a contract. Requiring it turned every `score_low`/`score_mid` turn into a silent no-op
 * for any question whose topic the pool did not happen to echo.
 */
function pickCandidate(
  candidates: Candidate[],
  move: Extract<AdaptiveSelection, { graded: true }>,
  currentTopic: string,
): Candidate | undefined {
  const atDifficulty = candidates.filter((c) => c.difficulty === move.difficulty);
  const wantSameTopic = move.topicMove === 'same';
  return (
    atDifficulty.find((c) => (c.topic === currentTopic) === wantSameTopic) ?? atDifficulty[0]
  );
}
