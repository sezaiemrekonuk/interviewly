/**
 * `GET /admin/interviews/:id` — the per-call drill-down (backend spec §Admin module, US-26 and
 * US-28/29). One interview, every provider call it paid for, and every event the system
 * recorded against it.
 *
 * Three reads rather than one nested include: `llm_calls` and `audit_logs` are unrelated to
 * each other and a join would multiply one by the other.
 */
import type { AuditLog, LlmCall, Prisma } from '@prisma/client';
import type { RequestHandler } from 'express';

import { ApiError } from '../../src/lib/api-error';
import { recordAudit } from '../../src/lib/audit';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { adminRead, applyReadHeaders } from '../../src/lib/read-replica';

/**
 * A ceiling, not a page. An interview asks at most 20 questions and each one costs a handful
 * of calls, so a real drill-down is tens of rows; this exists so a runaway retry loop cannot
 * hand the console a hundred thousand of them. `callsTruncated` says out loud when it bit,
 * because a silently short list reads as a complete one.
 * ponytail: cursor-page it if an interview ever legitimately exceeds this.
 */
const MAX_CALLS = 500;
const MAX_EVENTS = 200;

type DetailInterview = Prisma.InterviewGetPayload<{
  include: {
    occupation_cluster: { select: { key: true; label: true } };
    user: { select: { id: true; email_lower: true; role: true } };
    reports: { select: { status: true; prompt_uuid: true; prompt_version: true } };
  };
}>;

/**
 * The wire shape, as a pure function of three rows. Split out of the handler so the mapping
 * that the console reads — six-decimal money, ISO instants, the `second`-kind voice row — can
 * be checked without a database.
 */
export function shapeInterviewDetail(
  interview: DetailInterview,
  calls: LlmCall[],
  events: AuditLog[],
  callsTruncated: boolean,
) {
  return {
    interview: {
      id: interview.id,
      userId: interview.user.id,
      userEmail: interview.user.email_lower,
      mode: interview.mode,
      language: interview.language,
      state: interview.state,
      endedReason: interview.ended_reason,
      deleted: interview.deleted_at !== null,
      occupation: interview.occupation,
      occupationCluster: interview.occupation_cluster?.key ?? null,
      occupationLabel: interview.occupation_cluster?.label ?? null,
      targetQuestionCount: interview.target_question_count,
      hrQuestionCount: interview.hr_question_count,
      // Six decimals, as strings, for the same reason the list projects them that way: a
      // Decimal(12,6) that goes through a JS number stops being the figure the ledger holds.
      budgetUsd: interview.budget_usd.toFixed(6),
      spentUsd: interview.spent_usd.toFixed(6),
      elapsedSeconds: interview.elapsed_seconds,
      createdAt: interview.created_at.toISOString(),
      startedAt: interview.started_at?.toISOString() ?? null,
      endedAt: interview.ended_at?.toISOString() ?? null,
      deletedAt: interview.deleted_at?.toISOString() ?? null,
      // US-28: the prompt lineage that produced the report, which is what a rollback needs.
      report: interview.reports[0]
        ? {
            status: interview.reports[0].status,
            promptUuid: interview.reports[0].prompt_uuid,
            promptVersion: interview.reports[0].prompt_version,
          }
        : null,
    },
    calls: calls.map((call) => ({
      id: call.id,
      provider: call.provider,
      model: call.model,
      promptUuid: call.prompt_uuid,
      promptVersion: call.prompt_version,
      attemptNo: call.attempt_no,
      fellBackFrom: call.fell_back_from,
      units: call.units.toString(),
      // K12/§3.5: a voice call is charged in seconds, so it appears here as its own row
      // with `unitKind: 'second'` rather than folded into a token total that would be a lie.
      unitKind: call.unit_kind,
      inputTokens: call.input_tokens,
      outputTokens: call.output_tokens,
      costUsd: call.cost_usd.toFixed(6),
      latencyMs: call.latency_ms,
      traceId: call.trace_id,
      createdAt: call.created_at.toISOString(),
    })),
    callsTruncated,
    events: events.map((event) => ({
      id: event.id,
      action: event.action,
      actorUserId: event.actor_user_id,
      traceId: event.trace_id,
      metadata: event.metadata,
      createdAt: event.created_at.toISOString(),
    })),
  };
}

export const getAdminInterview: RequestHandler = async (req, res, next) => {
  try {
    const id = String(req.params.id);

    // ponytail: adminRead's fallback treats ANY thrown error (including this ApiError) as "the
    // replica failed", so an interview that's genuinely missing is looked up twice — once on
    // the replica, once on the primary — before the 404 surfaces. Correct, just one redundant
    // query in the not-found path; split "replica down" from "app error" if that ever matters.
    const { data, source, lagSeconds } = await adminRead(async (client) => {
      // ADMIN AUDIT — no `deleted_at: null`. A deleted interview is exactly the one an admin
      // opens this page for (K11), so the soft-delete helper is bypassed here as it is on the
      // list. `findUnique` and not `findFirst`: the id is the whole predicate.
      const interview = await client.interview.findUnique({
        where: { id },
        include: {
          occupation_cluster: { select: { key: true, label: true } },
          user: { select: { id: true, email_lower: true, role: true } },
          reports: { select: { status: true, prompt_uuid: true, prompt_version: true } },
        },
      });
      if (!interview) throw new ApiError('INTERVIEW_NOT_FOUND');

      const [calls, events] = await Promise.all([
        client.llmCall.findMany({
          where: { interview_id: id },
          orderBy: { created_at: 'asc' },
          take: MAX_CALLS + 1,
        }),
        // US-29. Every row the system wrote about this interview: the injection suspicions, the
        // budget and time trips, and the soft delete. Admin *reads* are recorded against the
        // list rather than an interview, so they do not crowd this timeline out.
        client.auditLog.findMany({
          where: { subject_type: 'interview', subject_id: id },
          orderBy: { created_at: 'desc' },
          take: MAX_EVENTS,
        }),
      ]);

      const callsTruncated = calls.length > MAX_CALLS;
      const page = callsTruncated ? calls.slice(0, MAX_CALLS) : calls;

      return { interview, page, events, callsTruncated };
    });

    const { interview, page, events, callsTruncated } = data;

    await recordAudit(prisma, {
      actorUserId: req.user!.id,
      action: 'admin.interview_read',
      subjectType: 'interview',
      subjectId: id,
      traceId: req.traceId,
    });

    logger.info({ traceId: req.traceId, interviewId: id }, 'ADMIN_INTERVIEW_READ');

    applyReadHeaders(res, { data, source, lagSeconds });

    res.status(200).json(shapeInterviewDetail(interview, page, events, callsTruncated));
  } catch (err) {
    next(err);
  }
};
