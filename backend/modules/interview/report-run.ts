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
  ReportPayloadSchema,
  type AiClient,
  type AiCtx,
  type ReportIntegrity,
  type ReportPayload,
  type Scores,
} from '@interviewly/ai';

import { aiClient } from '../ai';
import { prisma } from '../../src/lib/db';
import { reportPrompt } from './report-row';
import { logger } from '../../src/lib/logger';

import { profileVariables } from './generation';
import { applyTransition } from './machine';

export interface ReportOpts {
  traceId: string;
  /** Defaults to the module's client. Injected only by tests that need a misbehaving one. */
  client?: AiClient;
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

/**
 * C07 — the conduct half of the interview, which the transcript cannot carry.
 *
 * `turnsOf` walks questions and answers, so by construction it sees nothing that happened
 * outside an answer: a `role: 'system'` refusal row is not a question, and the flag on a
 * candidate message is a column rather than text. Both live only in `chat_messages`, so the
 * report reads them from there or does not learn about them at all — which is what shipped
 * before this, and is how a candidate who opened by trying to end the interview was reported
 * as having simply not said very much.
 *
 * ONE query on purpose, not three counts. The rows are few (an interview with more than a
 * handful of these is already over), the `[interview_id, created_at]` index covers the scan,
 * and three round trips to count three values on the same table is three chances for them to
 * disagree about which moment they describe. Reduced in JS because the flagged CONTENT has to
 * come back anyway — once the rows are in hand, counting them costs nothing.
 */
async function integrityOf(interviewId: string): Promise<ReportIntegrity> {
  const rows = await prisma.chatMessage.findMany({
    where: {
      interview_id: interviewId,
      // The union of the three things the report is allowed to know about. Anything else in
      // the conversation is already represented in the transcript.
      OR: [{ flagged_injection: true }, { action: { in: ['refused', 'drift'] } }],
    },
    orderBy: { created_at: 'asc' },
    select: { role: true, content: true, action: true, flagged_injection: true },
  });

  return {
    // `role: 'user'` and not just the flag: only a candidate utterance is conduct BY the
    // candidate. The server's own refusal note quotes the attempt back at the interviewer,
    // and counting that row would double every attempt the candidate made.
    flaggedUtterances: rows
      .filter((r) => r.flagged_injection && r.role === 'user')
      .map((r) => r.content),
    refusals: rows.filter((r) => r.action === 'refused').length,
    forcedAdvances: rows.filter((r) => r.action === 'drift').length,
  };
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

  // The run has started. `updateMany` and not `update`: a job redelivered after the row was
  // already finished must not resurrect it, and a run whose row is missing entirely (an
  // interview enqueued before this shipped) still has to be able to proceed.
  await prisma.report.updateMany({
    where: { interview_id: interviewId, status: { in: ['queued', 'failed'] } },
    data: { status: 'generating' },
  });

  const turns = await turnsOf(interviewId);
  const integrity = await integrityOf(interviewId);

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
      // C03. `turnsOf` already dropped every question with no answer, so `turns.length` is
      // literally "how much of the interview happened" and the target is what it set out to
      // do. Null `ended_reason` is a report generated off a path that never wrote one — the
      // pre-C03 rows, and the direct `runReport` calls — and `completed` is the only honest
      // default there: it is the reason the prompt treats as "nothing was cut short", so a
      // missing value reads as no claim rather than as an early stop the model then explains.
      endedReason: interview.ended_reason ?? 'completed',
      answeredCount: turns.length,
      plannedCount: interview.target_question_count,
      // C07. An interview from before the conductor wrote any of this — or one that simply
      // behaved — produces zeroes and an empty list, which `reportVars` renders as "no
      // integrity concerns". That is the honest reading in both cases: nothing was recorded,
      // so nothing is claimed, and v4 is instructed to write those reports clean.
      integrity,
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

  // The report is written BEFORE the transition (issue 082). The two still commit separately,
  // but a crash in the window now leaves `evaluating` with a report row — which the retry
  // recovers — instead of `completed` with nothing, which nothing can re-enqueue.
  //
  // Create-only: once one worker writes `reports(interview_id)`, retries/concurrent losers keep
  // that row as source of truth and do not rewrite payload/question rows.
  const row = {
    status: 'ready' as const,
    payload: gated.data,
    prompt_uuid: reportPrompt().uuid,
    prompt_version: reportPrompt().version,
  };
  await prisma.$transaction(async (tx) => {
    // The `evaluating → completed` CAS used to gate this block; it runs after it now, so two
    // workers on a redelivered stalled job would otherwise both write. Serialised here rather
    // than left to the unique indexes, which would fail the loser's job instead of ordering it.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${interviewId}))`;

    // The row now exists from enqueue onward (issue #123), so "did I win" can no longer be
    // "did my insert succeed". It is a compare-and-set on the status instead: exactly one
    // caller moves it off a live state, and a loser finds `ready` and writes nothing —
    // the same exclusivity the create-and-catch-P2002 gave, over a row that is already there.
    const claimed = await tx.report.updateMany({
      where: { interview_id: interviewId, status: { not: 'ready' } },
      data: row,
    });

    let report: { id: string } | null = null;
    if (claimed.count > 0) {
      report = await tx.report.findUnique({
        where: { interview_id: interviewId },
        select: { id: true },
      });
    } else {
      // No row at all is the pre-#123 shape — an interview enqueued before this shipped, or a
      // direct `runReport`. Create it, and keep the P2002 catch for the race that insert can
      // still lose.
      const missing = (await tx.report.count({ where: { interview_id: interviewId } })) === 0;
      if (missing) {
        try {
          report = await tx.report.create({
            data: { interview_id: interviewId, ...row },
            select: { id: true },
          });
        } catch (err) {
          if ((err as { code?: string } | null)?.code !== 'P2002') throw err;
        }
      }
    }
    if (!report) return;
    await tx.reportQuestion.createMany({
      data: denormalised.map((q) => ({
        report_id: report.id,
        question_id: q.question_id,
        score: q.score,
        reason: q.reason,
        star_adherence: q.star_adherence,
      })) satisfies Prisma.ReportQuestionCreateManyInput[],
      skipDuplicates: true,
    });
  });

  // Second, and still the CAS that makes this run exclusive: a concurrent job finds `evaluating`
  // gone and throws rather than reporting a second completion.
  await applyTransition(interview, 'completed', { traceId: opts.traceId });
}

/**
 * The invalid branch: interview `failed`, and the report row marked `failed` with no payload
 * (issue #123). "No payload stored" is still asserted as the absence of a payload rather than
 * a partial one — nothing half-written is kept — but the row itself now says what happened
 * instead of vanishing, which is what made a lost report an investigation rather than a query.
 *
 * `updateMany` guarded on `not: 'ready'`: a finished report is a deliverable, and a late
 * failure on a redelivered job must not overwrite one.
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
  await prisma.report.updateMany({
    where: { interview_id: ctx.interviewId, status: { not: 'ready' } },
    data: { status: 'failed' },
  });
  await applyTransition(interview, 'failed', { traceId: ctx.traceId });
}
