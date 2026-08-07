import type { Prisma } from '@prisma/client';
import { ReportPayloadSchema } from '@interviewly/ai';
import type { RequestHandler } from 'express';

import { prisma, userInterviews } from '../../src/lib/db';

import { decodeCursor, encodeCursor, pageLimit } from './cursor';

/**
 * The two fields a progress chart needs, derived from K15's payload schema rather than
 * restated: a second literal here would drift the moment `rounds[]` gains a member. Picked
 * down to what is read so a payload whose *other* half has moved on still yields its score —
 * losing a whole interview's point on the trend line is worse than tolerating an unread key.
 */
const ReportScoresSchema = ReportPayloadSchema.pick({ overall_score: true, rounds: true });

const NO_SCORES = { overallScore: null, roundScores: { hr: null, tech: null } };

/**
 * `reports.payload` is stored JSON. It was gated by `ReportPayloadSchema` on write, but this
 * read is years downstream of that write, so a payload that no longer parses degrades the row
 * to nulls instead of 500-ing a list where every other interview is fine.
 */
function reportScores(payload: Prisma.JsonValue | undefined) {
  const parsed = ReportScoresSchema.safeParse(payload);
  if (!parsed.success) return NO_SCORES;

  const roundScore = (type: 'hr' | 'tech') =>
    parsed.data.rounds.find((round) => round.type === type)?.score ?? null;

  return {
    overallScore: parsed.data.overall_score,
    // Both keys always present: the client charts two series, and an absent key and a null
    // score are the same fact to it. A short interview really can have no technical round.
    roundScores: { hr: roundScore('hr'), tech: roundScore('tech') },
  };
}

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
        // The scores ride on the list so a trend chart is one request. The join is on the page
        // query (db.ts), not per row — an N+1 here would be one round trip per interview.
        ...reportScores(row.reports[0]?.payload),
      })),
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].id) : null,
    });
  } catch (err) {
    next(err);
  }
};
