/**
 * `GET /admin/llm-calls` — the console's "Model calls" section.
 *
 * Every provider call the system has made, newest first, filterable by provider, model and
 * interview. The rows were being written since I02 and read by nothing: the drill-down shows
 * one interview's calls, and this is the same table across all of them, which is what an
 * operator asks when the question is about a model rather than about a candidate.
 *
 * `llm_calls` has no success/failure column, so no error rate is derivable here and none is
 * invented. `fellBackFrom` is the failure signal that does exist — a non-null value means the
 * tier above it did not answer — and it is projected for exactly that reason.
 */
import type { Prisma } from '@prisma/client';
import type { Request, RequestHandler } from 'express';

import { recordAudit } from '../../src/lib/audit';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

import { findManyArgs, listEnvelope, listParams } from './list';
import { CALL_SPEC } from './specs';

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

export function llmCallFilters(query: Request['query']): Prisma.LlmCallWhereInput {
  const provider = asString(query.provider);
  const model = asString(query.model);
  const interviewId = asString(query.interviewId);

  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(interviewId ? { interview_id: interviewId } : {}),
  };
}

export const listLlmCalls: RequestHandler = async (req, res, next) => {
  try {
    const params = listParams(req.query, CALL_SPEC);
    // The discrete facets and the query language AND together: a dropdown and a typed term are
    // two ways of asking, and picking one over the other would silently drop the operator's.
    const where = { ...llmCallFilters(req.query), ...params.search.where };
    const cursorExists = params.cursorId
      ? Boolean(
          await prisma.llmCall.findUnique({ where: { id: params.cursorId }, select: { id: true } }),
        )
      : false;

    const rows = await prisma.llmCall.findMany({ where, ...findManyArgs(params, cursorExists) });

    // The distinct providers and models present, so the console can offer a filter it knows
    // will match something instead of a free-text box. Unfiltered on purpose — a facet list
    // that narrowed with the selection could not be used to change the selection.
    //
    // Was `llmCall.groupBy(['provider','model'])` — the same unbounded full-table scan
    // `/admin/stats`'s perModel had (see LlmModelStat in schema.prisma). Reads the running
    // totals `recordLlmCall` (db.ts) keeps instead.
    const facets = await prisma.llmModelStat.findMany({ orderBy: { calls: 'desc' } });

    const envelope = listEnvelope(
      rows,
      params,
      (call) => ({
        id: call.id,
        interviewId: call.interview_id,
        provider: call.provider,
        model: call.model,
        promptUuid: call.prompt_uuid,
        promptVersion: call.prompt_version,
        attemptNo: call.attempt_no,
        fellBackFrom: call.fell_back_from,
        units: call.units.toString(),
        unitKind: call.unit_kind,
        inputTokens: call.input_tokens,
        outputTokens: call.output_tokens,
        costUsd: call.cost_usd.toFixed(6),
        latencyMs: call.latency_ms,
        traceId: call.trace_id,
        createdAt: call.created_at.toISOString(),
      }),
      (call) => call.id,
    );

    await recordAudit(prisma, {
      actorUserId: req.user!.id,
      action: 'admin.llm_calls_read',
      subjectType: 'llm_call_list',
      traceId: req.traceId,
      metadata: {
        count: envelope.items.length,
        filters: where as Prisma.InputJsonValue,
        query: params.search.applied,
      },
    });

    logger.info({ traceId: req.traceId, count: envelope.items.length }, 'ADMIN_LLM_CALLS_LISTED');

    res.status(200).json({
      ...envelope,
      facets: facets.map((facet) => ({
        provider: facet.provider,
        model: facet.model,
        count: facet.calls,
      })),
    });
  } catch (err) {
    next(err);
  }
};
