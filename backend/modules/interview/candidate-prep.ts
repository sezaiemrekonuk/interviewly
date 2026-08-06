/**
 * D02 — Next-question candidate pre-generation during a turn (K4 / ai spec B5).
 *
 * Generates easier/same/harder candidates for the N+1 question row and persists all three
 * into `questions.candidates`; D03 reads them back and promotes one.
 *
 * "Pre" is relative to the promotion, not to the turn: D03 calls this during the turn that
 * answers question N, for the row that turn is about to promote. There is no earlier moment
 * to call it from — the pool has to reflect the answer's language (I10 switches it on this
 * same turn), and a pool generated a turn ahead would be for a row whose difficulty the
 * previous promotion had not yet decided.
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

export interface PrepareNextCandidatesOpts {
  interview: { id: string; language: string };
  /**
   * The N+1 row, already resolved by the caller. D03 resolves it anyway — to check
   * `chosen_reason` and to promote into it — so re-deriving the per-round `order_index` here
   * would be a second copy of the index math, and a second chance to write onto the wrong row.
   */
  nextQuestionId: string;
  currentQuestion: { text: string; difficulty: Difficulty; topic: string };
  ctx: AiCtx;
  /** Injected by tests; defaults to the I02 adapter. */
  client?: AiClient;
}

/**
 * Pre-generates three candidates (easier / same / harder) for the N+1 question row and
 * persists them into `questions.candidates`. Returns the candidates so D03 need not re-read.
 */
export async function prepareNextCandidates({
  interview,
  nextQuestionId,
  currentQuestion,
  ctx,
  client,
}: PrepareNextCandidatesOpts): Promise<Candidate[]> {
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
    where: { id: nextQuestionId },
    data: { candidates },
  });

  logger.info(
    {
      traceId: ctx.traceId,
      interviewId: interview.id,
      questionId: nextQuestionId,
      count: candidates.length,
      difficulties: candidates.map((c) => c.difficulty),
    },
    'QUESTION_CANDIDATES_GENERATED',
  );

  return candidates;
}
