// `nextCursor` is opaque BY CONVENTION only — the client hands the token back unchanged.
// It is base64url(id), trivially reversible and hand-buildable, so it is not a security
// boundary. What keeps a caller off someone else's row is the `where` on the query itself:
// `userInterviews` filters `user_id` before the cursor is applied. Never lean on this
// function for access control.
export const encodeCursor = (id: string): string => Buffer.from(id).toString('base64url');

const CUID = /^[a-z0-9]{20,32}$/;

/**
 * Shape check only — it skips a pointless query on garbage, and says nothing about whether
 * the row exists or who owns it. Both call sites resolve the decoded id against their own
 * `where` before paging on it, so an unknown or foreign cursor falls back to page one.
 *
 * For the record, since a review round turned on it: Prisma's `cursor` does NOT throw on an
 * id absent from the filtered set — measured against this schema, a user with 3 rows and a
 * bogus cursor gets 0 rows and no exception. The resolve step is therefore about deterministic
 * paging, not about avoiding a 500.
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
