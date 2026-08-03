/**
 * The §5.5 layer-2 gate on the report artifact (I09, K15, ADR-I12).
 *
 * `runReport` is a plain function, not an Express handler: the acceptance step-def calls it
 * directly today and the report ledger's BullMQ worker calls the same function tomorrow. It
 * owns exactly one decision — a `ReportPayload` that survives the Zod gate transitions
 * `evaluating → completed` and is stored; one that does not transitions `evaluating → failed`
 * and stores nothing.
 */
import type { Prisma } from '@prisma/client';
import {
  AiError,
  PROMPT_NAMES,
  ReportPayloadSchema,
  loadPromptRegistry,
  type AiClient,
  type AiCtx,
  type ReportPayload,
  type Scores,
} from '@interviewly/ai';

import { aiClient } from '../ai';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

import { profileVariables } from './generation';
import { applyTransition } from './machine';

export interface ReportOpts {
  traceId: string;
  /** Defaults to the module's client. Injected only by tests that need a misbehaving one. */
  client?: AiClient;
}

let promptIdentity: { uuid: string; version: number } | undefined;

/**
 * `reports.prompt_uuid`/`prompt_version` name the lineage that produced the payload. Read
 * from the registry, which is the same resolution the client compiled with, rather than from
 * the `llm_calls` row — the live chain can fall back to another provider, but never to
 * another prompt.
 */
function reportPrompt(): { uuid: string; version: number } {
  const file = (promptIdentity ??= loadPromptRegistry().resolve(PROMPT_NAMES.generateReport));
  return file;
}

interface Turn {
  questionId: string;
  roundType: string;
  index: number;
  question: string;
  answer: string;
  scores: Scores | null;
}

/**
 * Answered turns in ask order, HR round first.
 *
 * The question id travels into the transcript because `ReportPayload.questions[].question_id`
 * has to point back at a row: without it the model has nothing to key its per-question scores
 * on, and `report_questions` cannot be denormalised at all.
 */
async function turnsOf(interviewId: string): Promise<Turn[]> {
  const rounds = await prisma.interviewRound.findMany({
    where: { interview_id: interviewId },
    include: {
      questions: {
        orderBy: { order_index: 'asc' },
        include: { answers: { orderBy: { answered_at: 'asc' } } },
      },
    },
  });

  // Sorted here rather than by `orderBy`: the ask order is hr-then-tech, which is a fact about
  // the interview, not about how Postgres happens to order the enum.
  return rounds
    .sort((a, b) => (a.type === b.type ? 0 : a.type === 'hr' ? -1 : 1))
    .flatMap((round) =>
      round.questions
        .filter((q) => q.answers.length > 0)
        .map((q) => ({
          questionId: q.id,
          roundType: round.type,
          index: q.order_index,
          question: q.text,
          answer: q.answers[q.answers.length - 1].transcript,
          scores: (q.answers[q.answers.length - 1].scores as Scores | null) ?? null,
        })),
    );
}

function formatTranscript(turns: Turn[]): string {
  return turns
    .map(
      (t) =>
        `[${t.roundType} ${t.index}] (question_id: ${t.questionId})\nQ: ${t.question}\nA: ${t.answer}`,
    )
    .join('\n\n');
}

export async function runReport(interviewId: string, opts: ReportOpts): Promise<void> {
  // Not `userInterviews`: a job has no session user. `deleted_at` still applies — a candidate
  // who deleted the interview must not have a report generated for it afterwards.
  const interview = await prisma.interview.findFirstOrThrow({
    where: { id: interviewId, deleted_at: null },
  });
  const ctx: AiCtx = { interviewId, traceId: opts.traceId };
  const turns = await turnsOf(interviewId);

  let payload: ReportPayload;
  try {
    const client = opts.client ?? aiClient();
    payload = await client.generateReport({
      transcript: formatTranscript(turns),
      // The scoring hook is the adaptive ledger's; an interview with no scored answers sends
      // `none` and the evaluation reasons from the transcript alone.
      perAnswerScores: turns.flatMap((t) => (t.scores ? [t.scores] : [])),
      ...profileVariables(interview),
      language: interview.language,
      ctx,
    });
  } catch (err) {
    // `AI_OUTPUT_INVALID` is the chain reporting that every attempt failed the same schema
    // this function is about, so it lands on the same branch as a locally invalid payload.
    // Anything else — provider exhausted, timeout — leaves the interview in `evaluating` for
    // the report ledger's retry rather than burning the one-shot terminal edge.
    if (err instanceof AiError && err.code === 'AI_OUTPUT_INVALID') {
      return failReport(interview, ctx, err.message);
    }
    throw err;
  }

  // The gate. It runs a second time here on purpose: `AiClient` validates what a provider
  // returned, this validates what reached *this* function, and the two are only the same
  // object while nothing is ever injected between them.
  const gated = ReportPayloadSchema.safeParse(payload);
  if (!gated.success) return failReport(interview, ctx, gated.error.message);

  // First, because it is the CAS that makes this run exclusive: a second job on the same
  // interview finds `evaluating` gone and throws before it can write a second report.
  await applyTransition(interview, 'completed', { traceId: opts.traceId });

  const known = new Set(turns.map((t) => t.questionId));
  const denormalised = gated.data.questions.filter((q) => known.has(q.question_id));
  if (denormalised.length < gated.data.questions.length) {
    // Model-invented ids are content, not a schema failure — the payload is still stored. Only
    // the relational copy drops them, because a bad FK would roll back a valid report.
    logger.warn(
      { traceId: opts.traceId, interviewId, dropped: gated.data.questions.length - denormalised.length },
      'REPORT_QUESTION_ID_UNKNOWN',
    );
  }

  // ponytail: the transition above is committed separately from this write, so a crash between
  // them leaves `completed` with no report row. The report ledger's retry/dead-letter (R01) is
  // where that is recovered; a shared transaction would mean routing every state write through
  // a tx-aware `applyTransition`, which nothing else needs.
  await prisma.$transaction(async (tx) => {
    const report = await tx.report.create({
      data: {
        interview_id: interviewId,
        status: 'ready',
        payload: gated.data,
        prompt_uuid: reportPrompt().uuid,
        prompt_version: reportPrompt().version,
      },
    });
    await tx.reportQuestion.createMany({
      data: denormalised.map((q) => ({
        report_id: report.id,
        question_id: q.question_id,
        score: q.score,
        reason: q.reason,
        star_adherence: q.star_adherence,
      })) satisfies Prisma.ReportQuestionCreateManyInput[],
    });
  });
}

/**
 * The invalid branch: state `failed`, no `reports` row at all. "No payload stored" is asserted
 * as the absence of the row rather than a null column, so nothing partial is written here.
 */
async function failReport(
  interview: Parameters<typeof applyTransition>[0],
  ctx: AiCtx,
  reason: string,
): Promise<void> {
  logger.warn(
    { traceId: ctx.traceId, interviewId: ctx.interviewId, reason },
    'AI_OUTPUT_SCHEMA_INVALID',
  );
  await applyTransition(interview, 'failed', { traceId: ctx.traceId });
}
