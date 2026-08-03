/**
 * Round question generation (§3.7, ADR-I07, ADR-I22).
 *
 * One `AiClient` call produces a whole round; this module owns the requested count, the
 * length check the schema deliberately does not make, and the row insertion. `ai` owns
 * prompt compilation, the provider chain and the per-attempt audit row — nothing here builds
 * a prompt string or reads a provider key.
 */
import type { Interview, Prisma } from '@prisma/client';
import {
  AiError,
  type AiClient,
  type AiCtx,
  type GenerateRoundQuestionsArgs,
  type RoundType,
} from '@interviewly/ai';

import { aiClient } from '../ai';
import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

import { applyTransition } from './machine';

export interface GenerateOpts {
  traceId: string;
  /** Defaults to the module's client. Injected only by tests that need a misbehaving one. */
  client?: AiClient;
}

/** `hr_question_count` for the HR round, the remainder of the target for the technical one. */
export function roundCount(interview: Interview, roundType: RoundType): number {
  return roundType === 'hr'
    ? interview.hr_question_count
    : interview.target_question_count - interview.hr_question_count;
}

/**
 * The §3.3 snapshot, split into the two prompt variables it feeds.
 *
 * The CV is its own argument, never concatenated into the profile object: the builder gives
 * it its own `<candidate_cv>` block, neutralised and truncated like the job listing, because
 * it is a PDF a stranger wrote. Absent halves stay `null` so the builder emits
 * `no profile provided` / `no cv provided` rather than an empty block.
 *
 * I09 feeds report generation from this same helper (K15) — the CV reaches the evaluation as
 * data too, and the date of birth reaches neither.
 */
export function profileVariables(interview: Interview): {
  candidateProfile: unknown | null;
  candidateCv: string | null;
} {
  const snapshot = interview.candidate_profile as Record<string, unknown> | null;
  if (!snapshot) return { candidateProfile: null, candidateCv: null };

  // `POST /profile` omits an absent half rather than storing it as null, so key count is the
  // honest emptiness test — and an empty object must still compile to `no profile provided`.
  const { cvText, ...rest } = snapshot;
  return {
    candidateProfile: Object.keys(rest).length > 0 ? rest : null,
    candidateCv: typeof cvText === 'string' && cvText.length > 0 ? cvText : null,
  };
}

/**
 * Exported because the acceptance suite compiles the same prompt an HTTP request compiled
 * internally, and re-deriving this mapping in a test would let the two drift apart silently.
 */
export function roundQuestionArgs(
  interview: Interview,
  roundType: RoundType,
  ctx: AiCtx,
): GenerateRoundQuestionsArgs {
  return {
    roundType,
    count: roundCount(interview, roundType),
    jobListing: interview.job_text,
    language: interview.language,
    ...profileVariables(interview),
    ctx,
  };
}

/** The seeded persona for a round type. Personas are F02 reference data, never invented here. */
async function personaFor(roundType: RoundType): Promise<string> {
  const persona = await prisma.persona.findFirst({
    where: { role: roundType, active: true },
    orderBy: { id: 'asc' },
  });
  // Not an ApiError: a missing seeded persona is a broken deployment, not a request the
  // caller got wrong, and app.ts already turns an unknown throw into an opaque 500.
  if (!persona) throw new Error(`no active persona seeded for round type ${roundType}`);
  return persona.id;
}

/**
 * Generates one round and inserts its questions.
 *
 * Failure semantics differ by cause, and the difference is the point:
 *
 *  - **Length mismatch** — the model returned a schema-valid batch of the wrong size. No rows
 *    are handed back, `AI_OUTPUT_INVALID` is raised, and the interview keeps its state so the
 *    round can simply be generated again.
 *  - **Provider unavailable** — the chain is exhausted, which is not something a retry in the
 *    next millisecond fixes. The interview moves to `paused` so it is resumable (I07 owns the
 *    rest of that table) instead of being stranded mid-transition.
 */
export async function generateRound(
  interview: Interview,
  roundType: RoundType,
  opts: GenerateOpts,
): Promise<void> {
  const count = roundCount(interview, roundType);
  const ctx: AiCtx = { interviewId: interview.id, traceId: opts.traceId };

  logger.info(
    { traceId: opts.traceId, interviewId: interview.id, roundType, count },
    roundType === 'hr' ? 'HR_BATCH_REQUESTED' : 'TECH_BATCH_REQUESTED',
  );

  let batch;
  try {
    const client = opts.client ?? aiClient();
    batch = await client.generateRoundQuestions(roundQuestionArgs(interview, roundType, ctx));
  } catch (err) {
    if (!(err instanceof AiError)) throw err;
    if (err.code === 'AI_PROVIDER_UNAVAILABLE') {
      // I07: routed through applyTransition — the sole writer of interviews.state — so this
      // edge also gets the INTERVIEW_STATE_CHANGED emission + SSE fan-out for free.
      //
      // A failure to pause must not replace the caller's error. `applyTransition` now rejects
      // a transition another request already made, and answering 409 to a candidate whose
      // provider fell over would name the wrong problem.
      try {
        await applyTransition(interview, 'paused', { traceId: opts.traceId });
      } catch (pauseErr) {
        logger.error(
          { err: pauseErr, traceId: opts.traceId, interviewId: interview.id, roundType },
          'INTERVIEW_PAUSE_FAILED',
        );
      }
    }
    throw new ApiError(err.code);
  }

  // The requested count is runtime data, so `QuestionBatchSchema` cannot carry it (I01). This
  // is the check that makes the contract real, and it is all-or-nothing: a short batch inserts
  // nothing rather than leaving a half-filled round for the state walk to fall off the end of.
  if (batch.questions.length !== count) {
    logger.warn(
      {
        traceId: opts.traceId,
        interviewId: interview.id,
        roundType,
        expected: count,
        received: batch.questions.length,
      },
      'AI_OUTPUT_SCHEMA_INVALID',
    );
    throw new ApiError('AI_OUTPUT_INVALID');
  }

  const persona_id = await personaFor(roundType);

  await prisma.$transaction(async (tx) => {
    const round =
      (await tx.interviewRound.findFirst({
        where: { interview_id: interview.id, type: roundType },
      })) ??
      (await tx.interviewRound.create({
        data: { interview_id: interview.id, type: roundType, persona_id, status: 'pending' },
      }));

    await tx.question.createMany({
      // `order_index` is ours, counted 1..count in ask order. The model's `orderIndex` is
      // advisory content: trusting it would let a bad batch renumber or collide a round.
      data: batch.questions.map((q, i) => ({
        round_id: round.id,
        order_index: i + 1,
        text: q.text,
        kind: q.kind,
        difficulty: q.difficulty,
        topic: q.topic,
      })) satisfies Prisma.QuestionCreateManyInput[],
    });
  });
}

/**
 * ADR-I22: the technical batch is generated *during* the HR round, not by the transition into
 * it, so the round handover is never a loading screen and `POST /profile` never pays for two
 * LLM calls. Idempotent, because the caller is a per-answer hook (I06) and not a one-shot.
 */
export async function ensureTechBatch(interview: Interview, opts: GenerateOpts): Promise<void> {
  const existing = await prisma.question.count({
    where: { round: { interview_id: interview.id, type: 'tech' } },
  });
  if (existing > 0) return;
  await generateRound(interview, 'tech', opts);
}
