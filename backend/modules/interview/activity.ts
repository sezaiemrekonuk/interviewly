/**
 * `GET /me/interviews/activity?month=YYYY-MM` — how many interviews the account started on
 * each day of one month.
 *
 * An aggregate rather than a page. The dashboard's density grid needs a whole month, and
 * `/me/interviews` answers twenty rows: a busy month overflows one page, and any month older
 * than the newest twenty is not in it at all, so a client colouring squares from that list
 * would under-count the month it is showing and draw an empty one for a month the account
 * actually practised through (#245). Paging a whole history into the browser to shade thirty
 * cells is the other way to be wrong.
 *
 * Counted by `started_at`: the module answers "when did you sit down to practise", and an
 * interview that was created and never started is not practice. That is also why a row with a
 * NULL `started_at` simply misses every bucket rather than needing a branch.
 */
import type { RequestHandler } from 'express';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';

/** `YYYY-MM`, and a real month — `2026-13` is a client bug, not a query for December. */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

interface DayRow {
  date: string;
  count: number;
}

export const monthActivity: RequestHandler = async (req, res) => {
  const month = typeof req.query.month === 'string' ? req.query.month : '';
  if (!MONTH.test(month)) throw new ApiError('VALIDATION_ERROR');

  const from = new Date(`${month}-01T00:00:00.000Z`);
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));

  // Raw because Prisma's `groupBy` cannot group on an expression, and the day is one. The
  // column is `TIMESTAMP(3)` — no zone — and Prisma writes UTC instants into it, so
  // `date_trunc` is already truncating in UTC and an `AT TIME ZONE` here would shift it.
  //
  // Soft-delete is repeated rather than borrowed from `userInterviews`: that helper returns
  // rows, and this reads none. The predicate is the only thing the two have in common (K13).
  const days = await prisma.$queryRaw<DayRow[]>`
    SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS date,
           count(*)::int AS count
      FROM interviews
     WHERE user_id = ${req.user!.id}
       AND deleted_at IS NULL
       AND started_at >= ${from}
       AND started_at <  ${to}
     GROUP BY 1
     ORDER BY 1
  `;

  // Travels with the month so the picker knows where the account's history begins and cannot
  // walk back through years of empty grids. A second endpoint for one string would be a second
  // round trip on every month change.
  const [{ earliest }] = await prisma.$queryRaw<{ earliest: string | null }[]>`
    SELECT to_char(min(started_at), 'YYYY-MM') AS earliest
      FROM interviews
     WHERE user_id = ${req.user!.id} AND deleted_at IS NULL AND started_at IS NOT NULL
  `;

  res.status(200).json({
    month,
    days,
    // The scale, resolved here: the client shades against the busiest day of the month it is
    // showing, and deriving that from a partial view is exactly the bug this endpoint exists
    // to close.
    max: days.reduce((top, day) => Math.max(top, day.count), 0),
    earliest,
  });
};

export default monthActivity;
