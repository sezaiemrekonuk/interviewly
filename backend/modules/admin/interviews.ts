import type { RequestHandler } from 'express';

import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { decodeCursor, encodeCursor, pageLimit } from '../interview/cursor';

export const listAllInterviews: RequestHandler = async (req, res, next) => {
  try {
    const limit = pageLimit(req.query.limit);
    const cursor = decodeCursor(req.query.cursor);

    // ADMIN AUDIT — intentionally bypasses userInterviews (K11: deleted interviews counted).
    // The soft-delete filter is the whole point of the helper, so this is a direct read; it
    // is the only sanctioned prisma.interview.findMany call site outside modules/admin.
    const rows = await prisma.interview.findMany({
      orderBy: { created_at: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { occupation_cluster: { select: { key: true } } },
    });

    const page = rows.slice(0, limit);

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

    const items = page.map((row) => ({
      id: row.id,
      userId: row.user_id,
      state: row.state,
      deleted: row.deleted_at !== null,
      occupation: row.occupation,
      occupationCluster: row.occupation_cluster?.key ?? null,
      totalTokens: tokensFor.get(row.id) ?? 0,
      costUsd: row.spent_usd.toFixed(6),
    }));

    logger.info({ traceId: req.traceId, count: items.length }, 'ADMIN_INTERVIEWS_LISTED');

    res.status(200).json({
      items,
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].id) : null,
    });
  } catch (err) {
    next(err);
  }
};
