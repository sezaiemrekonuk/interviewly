import type { InterviewState, Prisma } from '@prisma/client';
import type { Request, RequestHandler } from 'express';

import { recordAudit } from '../../src/lib/audit';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

import { findManyArgs, listEnvelope, listParams } from './list';
import { INTERVIEW_SPEC } from './specs';

/**
 * The nine `InterviewState` values, listed rather than derived: Prisma exports the enum as a
 * type, and a runtime membership test needs runtime values. A `?state=` outside this set is
 * ignored, not rejected — the same rule `pageLimit` follows for a nonsense `?limit=`.
 */
const STATES = new Set<string>([
  'created',
  'profiling',
  'hr_round',
  'tech_round',
  'paused',
  'evaluating',
  'completed',
  'abandoned',
  'failed',
]);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/**
 * The spec's `?occupationCluster&state&userId` facets (backend §Admin module). Every one of
 * them narrows; none of them can widen, so the soft-delete bypass this endpoint is built on
 * survives every combination — a filtered page still shows deleted rows (K11).
 *
 * `occupationCluster` matches the cluster KEY, which is what the list projects and what the
 * console has to filter with; the id never leaves the server.
 */
export function interviewFilters(query: Request['query']): Prisma.InterviewWhereInput {
  const state = asString(query.state);
  const userId = asString(query.userId);
  const cluster = asString(query.occupationCluster);

  return {
    ...(state && STATES.has(state) ? { state: state as InterviewState } : {}),
    ...(userId ? { user_id: userId } : {}),
    ...(cluster ? { occupation_cluster: { key: cluster } } : {}),
  };
}

export const listAllInterviews: RequestHandler = async (req, res, next) => {
  try {
    const params = listParams(req.query, INTERVIEW_SPEC);
    // The dropdown facets and the typed query AND together — two ways of asking the same
    // list, and honouring only one of them would silently drop the operator's other half.
    const where = { ...interviewFilters(req.query), ...params.search.where };
    const cursorExists = params.cursorId
      ? Boolean(
          await prisma.interview.findUnique({
            where: { id: params.cursorId },
            select: { id: true },
          }),
        )
      : false;

    // ADMIN AUDIT — intentionally bypasses userInterviews (K11: deleted interviews counted).
    // The soft-delete filter is the whole point of the helper, so this is a direct read; it
    // is the only sanctioned prisma.interview.findMany call site outside modules/admin.
    const rows = await prisma.interview.findMany({
      where,
      ...findManyArgs(params, cursorExists),
      include: {
        occupation_cluster: { select: { key: true } },
        user: { select: { email_lower: true } },
      },
    });

    const page = rows.slice(0, params.limit);

    // One grouped query for the whole page rather than a sum per row.
    const totals = await prisma.llmCall.groupBy({
      by: ['interview_id'],
      where: { interview_id: { in: page.map((r) => r.id) } },
      _sum: { input_tokens: true, output_tokens: true },
    });
    const tokensFor = new Map(
      totals.map((t) => [
        t.interview_id,
        (t._sum.input_tokens ?? 0) + (t._sum.output_tokens ?? 0),
      ]),
    );

    const envelope = listEnvelope(
      rows,
      params,
      (row) => ({
        id: row.id,
        userId: row.user_id,
        // The account the row belongs to, resolved here rather than left as a bare cuid: the
        // console's "no user column" note existed only because nothing joined it. An erased
        // account (KVKK) carries an anonymised `email_lower`, so this is never raw PII of a
        // person who asked to be forgotten.
        userEmail: row.user.email_lower,
        state: row.state,
        deleted: row.deleted_at !== null,
        occupation: row.occupation,
        occupationCluster: row.occupation_cluster?.key ?? null,
        totalTokens: tokensFor.get(row.id) ?? 0,
        costUsd: row.spent_usd.toFixed(6),
        budgetUsd: row.budget_usd.toFixed(6),
        startedAt: row.started_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
      }),
      (row) => row.id,
    );

    // Issue 86: this endpoint reads every user's interviews, so the read is itself the
    // privileged act. One row per request, not per interview — the page is the subject, and
    // `subject_id` is null for exactly that reason. No transaction: a read has nothing to be
    // atomic with.
    await recordAudit(prisma, {
      actorUserId: req.user!.id,
      action: 'admin.interviews_read',
      subjectType: 'interview_list',
      traceId: req.traceId,
      // The filter goes in the row too: "who looked at this one account's interviews" is the
      // question the table is read with, and a count alone cannot answer it. Ids and keys
      // only — the same no-PII contract the column carries.
      metadata: {
        count: envelope.items.length,
        filters: where as Prisma.InputJsonValue,
        query: params.search.applied,
      },
    });

    logger.info(
      { traceId: req.traceId, count: envelope.items.length },
      'ADMIN_INTERVIEWS_LISTED',
    );

    res.status(200).json(envelope);
  } catch (err) {
    next(err);
  }
};
