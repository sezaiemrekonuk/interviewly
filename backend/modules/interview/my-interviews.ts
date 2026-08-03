import type { RequestHandler } from 'express';

import { prisma, userInterviews } from '../../src/lib/db';

import { decodeCursor, encodeCursor, pageLimit } from './cursor';

// User-facing, so it goes through F02's helper and inherits `deleted_at IS NULL`. A raw
// findMany here is the leak ADR-N02 rejects. No cost or token figures either: those are
// the admin audit's, not the candidate's.
export const listMyInterviews: RequestHandler = async (req, res, next) => {
  try {
    const limit = pageLimit(req.query.limit);
    const decoded = decodeCursor(req.query.cursor);
    const cursor = decoded
      ? (await prisma.interview.findFirst({
          where: { id: decoded, user_id: req.user!.id, deleted_at: null },
          select: { id: true },
        }))?.id
      : undefined;

    const rows = await userInterviews(req.user!.id, {
      limit: limit + 1,
      ...(cursor ? { cursor } : {}),
    });

    const page = rows.slice(0, limit);

    res.status(200).json({
      items: page.map((row) => ({
        id: row.id,
        state: row.state,
        mode: row.mode,
        occupation: row.occupation,
        endedReason: row.ended_reason,
        createdAt: row.created_at,
        startedAt: row.started_at,
        endedAt: row.ended_at,
      })),
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].id) : null,
    });
  } catch (err) {
    next(err);
  }
};
