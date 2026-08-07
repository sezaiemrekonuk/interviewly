/**
 * `GET /me/questions` — every turn the signed-in user has answered, across every interview
 * they still have, newest first.
 *
 * Driven off `answers` rather than `questions`: "answered" is the filter the whole endpoint is
 * about, and asking the answer table for it makes that a WHERE rather than a post-filter — an
 * unanswered question simply has no row here. It also gives the page a real sort key
 * (`answered_at`), which the question side does not have without ordering on a to-many.
 */
import type { Prisma } from '@prisma/client';
import { ScoresSchema } from '@interviewly/ai';
import type { RequestHandler } from 'express';

import { prisma } from '../../src/lib/db';

import { decodeCursor, encodeCursor, pageLimit } from './cursor';

/**
 * The security boundary, and the only place it is expressed: ownership is a predicate on the
 * query, so a row belonging to another user is never fetched — not fetched and then dropped in
 * JS, where a refactor can quietly lose the filter. `deleted_at` rides along for the same
 * reason `userInterviews` carries it (K13): a deleted interview is gone from every user-facing
 * read, and this is one.
 */
const ownedBy = (userId: string) => ({
  question: { round: { interview: { user_id: userId, deleted_at: null } } },
});

/**
 * `answers.scores` is JSON the adaptive hook wrote (adaptive.ts) and nothing re-validates on
 * read, so it is treated as untrusted input: a row written before `ScoresSchema` settled must
 * cost that row its detail, not the whole page a 500. Snake_case is the storage convention
 * (schemas.ts) — camelCase is the API's, and the conversion belongs here at the boundary.
 */
function answerScores(raw: Prisma.JsonValue | null) {
  const parsed = ScoresSchema.safeParse(raw);
  if (!parsed.success) return null;

  const { star_adherence: starAdherence, ...rest } = parsed.data;
  return { ...rest, starAdherence };
}

export const listMyQuestions: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const limit = pageLimit(req.query.limit);
    const decoded = decodeCursor(req.query.cursor);
    // Resolved against the same ownership predicate as the page itself, so a cursor lifted
    // from another user's response is not a cursor at all — it falls back to page one.
    const cursor = decoded
      ? (
          await prisma.answer.findFirst({
            where: { id: decoded, ...ownedBy(userId) },
            select: { id: true },
          })
        )?.id
      : undefined;

    const rows = await prisma.answer.findMany({
      where: ownedBy(userId),
      // `id` is the tiebreak, not decoration: `answered_at` is nullable and not unique, and a
      // Prisma cursor on a non-unique order silently repeats or skips a row at the page seam.
      orderBy: [{ answered_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        answered_at: true,
        duration_ms: true,
        scores: true,
        question: {
          select: {
            id: true,
            text: true,
            round: { select: { type: true, interview: { select: { id: true, occupation: true } } } },
            // The grader's verdict on this turn. A list, because `report_questions` is per
            // report and an interview can be re-reported; the newest ready report wins, and a
            // report that never reached `ready` has no verdict to show.
            report_questions: {
              where: { report: { status: 'ready' } },
              orderBy: { report: { created_at: 'desc' } },
              take: 1,
              select: { score: true, reason: true, star_adherence: true },
            },
          },
        },
      },
    });

    const page = rows.slice(0, limit);

    res.status(200).json({
      items: page.map((row) => {
        const graded = row.question.report_questions[0];
        return {
          questionId: row.question.id,
          interviewId: row.question.round.interview.id,
          occupation: row.question.round.interview.occupation,
          roundType: row.question.round.type,
          text: row.question.text,
          answeredAt: row.answered_at,
          durationMs: row.duration_ms,
          score: graded?.score ?? null,
          reason: graded?.reason ?? null,
          // Decimal(3,2) in Postgres, a Decimal *object* in the client. JSON.stringify would
          // ship it as a string, which no chart can plot.
          starAdherence: graded ? graded.star_adherence.toNumber() : null,
          answerScores: answerScores(row.scores),
        };
      }),
      // Keyed on the answer id, which is what the query pages on. Opaque by convention
      // (cursor.ts) — it is resolved against `ownedBy` above, never trusted on its face.
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].id) : null,
    });
  } catch (err) {
    next(err);
  }
};

export default listMyQuestions;
