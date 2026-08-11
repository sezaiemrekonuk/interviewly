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
import { decodeCursor, encodeCursor, pageLimit } from '../interview/cursor';

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
    const limit = pageLimit(req.query.limit);
    const where = llmCallFilters(req.query);
    const decoded = decodeCursor(req.query.cursor);
    const cursor = decoded
      ? (await prisma.llmCall.findUnique({ where: { id: decoded }, select: { id: true } }))?.id
      : undefined;

    const rows = await prisma.llmCall.findMany({
      where,
      // `created_at` desc with `id` as the tie-break: calls inside one turn share a
      // millisecond often enough that time alone is not a total order, and a cursor over a
      // non-total order repeats or skips rows between pages.
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const page = rows.slice(0, limit);

    // The distinct providers and models present, so the console can offer a filter it knows
    // will match something instead of a free-text box. Unfiltered on purpose — a facet list
    // that narrowed with the selection could not be used to change the selection.
    const facets = await prisma.llmCall.groupBy({
      by: ['provider', 'model'],
      _count: { _all: true },
      orderBy: { _count: { id: 'desc' } },
    });

    await recordAudit(prisma, {
      actorUserId: req.user!.id,
      action: 'admin.llm_calls_read',
      subjectType: 'llm_call_list',
      traceId: req.traceId,
      metadata: { count: page.length, filters: where as Prisma.InputJsonValue },
    });

    logger.info({ traceId: req.traceId, count: page.length }, 'ADMIN_LLM_CALLS_LISTED');

    res.status(200).json({
      items: page.map((call) => ({
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
      })),
      facets: facets.map((facet) => ({
        provider: facet.provider,
        model: facet.model,
        count: facet._count._all,
      })),
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].id) : null,
    });
  } catch (err) {
    next(err);
  }
};
