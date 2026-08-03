// base64url over the row id. That is ENCODING, not a security boundary: it is trivially
// reversible and a client can hand-build one. What keeps a caller off someone else's row is
// the `where` on the query itself — `userInterviews` filters `user_id` before the cursor is
// applied. Never lean on this function for access control.
export const encodeCursor = (id: string): string => Buffer.from(id).toString('base64url');

const CUID = /^[a-z0-9]{20,32}$/;

/**
 * Shape check only — it skips a pointless query on garbage, and says nothing about whether
 * the row exists or who owns it.
 *
 * It does not need to. Measured against this schema: Prisma's `cursor` does NOT throw on an
 * id that is absent from the filtered set — it returns an empty page (a user with 3 rows and
 * a bogus cursor gets 0, no exception). So a hand-made cursor is an empty page, not a 500,
 * and a foreign id is an empty page too because `userInterviews` filters by `user_id` before
 * the cursor is applied. Resolving the id first would cost a query per paged request and turn
 * a stale cursor into a re-serve of page one, which is worse for a paging client than the
 * end-of-list it reads today.
 */
export const decodeCursor = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value === '') return undefined;
  const id = Buffer.from(value, 'base64url').toString('utf8');
  return CUID.test(id) ? id : undefined;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Clamped rather than rejected: a nonsense `?limit=` pages, it does not 422. */
export const pageLimit = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
};
