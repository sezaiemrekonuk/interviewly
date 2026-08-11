/**
 * Round question generation (§3.7, ADR-I07, ADR-I22).
 *
 * One `AiClient` call produces a whole round; this module owns the requested count, the
 * length check the schema deliberately does not make, and the row insertion. `ai` owns
 * prompt compilation, the provider chain and the per-attempt audit row — nothing here builds
 * a prompt string or reads a provider key.
 */
import type { Interview, Persona, Prisma } from '@prisma/client';
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

import { applyTransition, canTransition } from './machine';
import { publishQuestionsReady, QUESTIONS_READY } from './sse';

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
  priorTopics: string[] = [],
): GenerateRoundQuestionsArgs {
  return {
    roundType,
    count: roundCount(interview, roundType),
    jobListing: interview.job_text,
    language: interview.language,
    ...profileVariables(interview),
    priorTopics,
    ctx,
  };
}

/**
 * What the other round already covers, for the prompt's "Topics already used" line.
 *
 * `priorTopics` has been a variable on `interview.question.generate` since v1 and nothing ever
 * bound anything to it — every technical batch in this system was written with "none", blind to
 * the round the candidate had just sat. That is how the technical interviewer opened by asking
 * what HR had already asked: the two batches were generated from the same job listing by the
 * same model with no knowledge of each other, so they converged.
 *
 * HR is generated first and from nothing, so this is empty for it by construction rather than
 * by a special case. ADR-I22 runs the technical batch *during* the HR round, by which point the
 * whole HR batch is on disk — the topics are all there whether or not they have been asked yet,
 * and an agenda that avoids a topic HR never reached is the right trade against one that
 * duplicates a topic HR did.
 */
async function priorTopicsFor(interviewId: string, roundType: RoundType): Promise<string[]> {
  if (roundType === 'hr') return [];
  const rows = await prisma.question.findMany({
    where: { round: { interview_id: interviewId, type: 'hr' } },
    select: { topic: true },
    orderBy: { order_index: 'asc' },
  });
  return [...new Set(rows.map((r) => r.topic))];
}

/**
 * The seeded persona for a round type. Personas are F02 reference data, never invented here.
 *
 * Prefer the deterministic `seed-persona-{role}` id. Nothing guarantees one active persona per
 * role, so `orderBy id asc` alone is fixture-roulette — test fixtures carry cuid ids that sort
 * before `seed-…` and would win the round. The by-role query stays as a fallback for
 * deployments predating the seeded ids. Shared with the conductor's `personaForRound` so
 * assignment and the name/brief the room reads back can't diverge.
 *
 * **Deliberately not memoised**, and a process-lifetime cache here has been proposed and
 * reverted once. Personas are editable reference data, not constants: `active` is how one is
 * retired, and `voice_id`, `name`, `brief` and `system_prompt` are all rows an admin can change.
 * Caching the row would mean a retired persona keeps conducting interviews, and a corrected
 * `voice_id` keeps 400ing per question, until every api and worker process happens to restart.
 * The read it saves is a primary-key lookup on a table of a handful of rows, called once per
 * turn — next to the LLM call that turn is waiting on, it is not measurable.
 */
export async function seededPersona(roundType: RoundType): Promise<Persona> {
  const persona =
    (await prisma.persona.findFirst({
      where: { id: `seed-persona-${roundType}`, active: true },
    })) ??
    (await prisma.persona.findFirst({
      where: { role: roundType, active: true },
      orderBy: { id: 'asc' },
    }));
  // Not an ApiError: a missing seeded persona is a broken deployment, not a request the
  // caller got wrong, and app.ts already turns an unknown throw into an opaque 500.
  if (!persona) throw new Error(`no active persona seeded for round type ${roundType}`);
  return persona;
}

export async function personaFor(roundType: RoundType): Promise<string> {
  return (await seededPersona(roundType)).id;
}

export async function generateRound(
  interview: Interview,
  roundType: RoundType,
  opts: GenerateOpts,
): Promise<void> {
  // Idempotent by round, for every caller and not just `ensureTechBatch`: I06's per-answer hook
  // and I07's `POST /resume` both call this for a round that may already be full, and a second
  // batch would collide `(round_id, order_index)` or — across two round rows — give the index
  // walk two questions for the same global index. The all-or-nothing insert below is what makes
  // a non-zero count mean "this round is done" rather than "this round is half written".
  const existing = await prisma.question.count({
    where: { round: { interview_id: interview.id, type: roundType } },
  });
  if (existing > 0) return;

  const count = roundCount(interview, roundType);
  const ctx: AiCtx = { interviewId: interview.id, traceId: opts.traceId };

  logger.info(
    { traceId: opts.traceId, interviewId: interview.id, roundType, count },
    roundType === 'hr' ? 'HR_BATCH_REQUESTED' : 'TECH_BATCH_REQUESTED',
  );

  let batch;
  try {
    const client = opts.client ?? aiClient();
    const priorTopics = await priorTopicsFor(interview.id, roundType);
    batch = await client.generateRoundQuestions(
      roundQuestionArgs(interview, roundType, ctx, priorTopics),
    );

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
  } catch (err) {
    if (!(err instanceof AiError) && !(err instanceof ApiError)) throw err;
    const code = err.code;
    // `canTransition` and not a try/catch around the pause: from `profiling` there is no
    // `paused` edge and none is wanted — `POST /profile` is itself the retry — so attempting
    // it would raise `INTERVIEW_PAUSE_FAILED`, an alarm for a case that is working as designed.
    if (
      (code === 'AI_PROVIDER_UNAVAILABLE' || code === 'AI_OUTPUT_INVALID') &&
      canTransition(interview.state, 'paused')
    ) {
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
    throw err instanceof ApiError ? err : new ApiError(code);
  }

  const persona_id = await personaFor(roundType);

  await prisma.$transaction(async (tx) => {
    const round = await tx.interviewRound.upsert({
      where: { interview_id_type: { interview_id: interview.id, type: roundType } },
      update: {},
      create: { interview_id: interview.id, type: roundType, persona_id, status: 'pending' },
    });

    await tx.question.createMany({
      // `order_index` is ours, counted 1..count in ask order. The model's `orderIndex` is
      // advisory content: trusting it would let a bad batch renumber or collide a round.
      data: batch.questions.map((q, i) => ({
        round_id: round.id,
        order_index: i + 1,
        text: q.text,
        // C05: the agenda line — what this slot is for, which the conductor writes the real
        // question from. `?? null` and not a default string because the column is nullable by
        // design: v1/v2 of the prompt do not emit it, and a row written from an older batch
        // must stay distinguishable from one whose intent the model actually wrote. The room
        // falls back to `text` when `intent` is null, which is exactly the pre-C05 behaviour.
        intent: q.intent ?? null,
        kind: q.kind,
        difficulty: q.difficulty,
        topic: q.topic,
      })) satisfies Prisma.QuestionCreateManyInput[],
    });
  });

  // After the commit, not inside it: an event for rows a rolled-back transaction never wrote
  // would send the room to refetch the empty state it is already showing. The early return
  // above stays silent for the same reason it exists — a round that was already full had its
  // event when it was written, and the caller that lost that race gets its own HTTP response.
  await publishQuestionsReady({
    type: QUESTIONS_READY,
    interviewId: interview.id,
    roundType,
  });
}

/**
 * ADR-I22: the technical batch is generated *during* the HR round, not by the transition into
 * it, so the round handover is never a loading screen and `POST /profile` never pays for two
 * LLM calls. Idempotent, because the caller is a per-answer hook (I06) and not a one-shot —
 * the guard itself now lives in `generateRound`, which every caller needs it from.
 */
export async function ensureTechBatch(interview: Interview, opts: GenerateOpts): Promise<void> {
  await generateRound(interview, 'tech', opts);
}
