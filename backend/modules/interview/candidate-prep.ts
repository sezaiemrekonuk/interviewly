/**
 * D02 — Next-question candidate pre-generation during a turn (K4 / ai spec B5).
 *
 * Pre-generates easier/same/harder candidates for the N+1 question row so the selector
 * (D01) and promoter (D03) never incur a mid-round LLM call. Persists all three into
 * `questions.candidates`; D03 reads them and promotes one.
 *
 * No scoring, no promotion, no new error codes — purely wiring `generateCandidates`
 * through the AiClient seam and persisting the result. Works at cost 0 under
 * AI_ENABLED=false via StubAiClient.
 */
import type { Difficulty } from '@prisma/client';
import type { AiClient, AiCtx, Candidate } from '@interviewly/ai';

import { aiClient as defaultAiClient } from '../ai';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { currentQuestionRow } from './state';

export interface PrepareNextCandidatesOpts {
  interview: { id: string; hr_question_count: number; current_index: number; language: string };
  currentQuestion: { text: string; difficulty: Difficulty; topic: string };
  ctx: AiCtx;
  /** Injected by tests; defaults to the I02 adapter. */
  client?: AiClient;
}

/**
 * Pre-generates three candidates (easier / same / harder) for the N+1 question row and
 * persists them into `questions.candidates`. Returns the candidates so D03 need not re-read.
 * Returns [] when there is no N+1 row (end of interview).
 */
export async function prepareNextCandidates({
  interview,
  currentQuestion,
  ctx,
  client,
}: PrepareNextCandidatesOpts): Promise<Candidate[]> {
  // Resolve N+1 using the existing state helper — avoids re-deriving per-round order math.
  const nextRow = await currentQuestionRow({
    id: interview.id,
    hr_question_count: interview.hr_question_count,
    current_index: interview.current_index + 1,
  });
  if (!nextRow) return [];

  const asked = await prisma.question.findMany({
    where: { round: { interview_id: interview.id }, asked_at: { not: null } },
    select: { topic: true },
  });
  const topicsUsed = [...new Set(asked.map((r) => r.topic))];

  const aiClientInstance = client ?? defaultAiClient();
  // priorScore is the midpoint default — D02 does not score; D01/D03 select by difficulty.
  const candidates = await aiClientInstance.generateCandidates({
    priorQuestion: currentQuestion.text,
    priorScore: 3,
    topicsUsed,
    language: interview.language,
    ctx,
  });

  await prisma.question.update({
    where: { id: nextRow.id },
    data: { candidates },
  });

  logger.info(
    {
      traceId: ctx.traceId,
      interviewId: interview.id,
      questionId: nextRow.id,
      count: candidates.length,
      difficulties: candidates.map((c) => c.difficulty),
    },
    'QUESTION_CANDIDATES_GENERATED',
  );

  return candidates;
}
