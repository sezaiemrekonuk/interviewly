// `nextCursor` is opaque so a client cannot hand-build one and page by raw row id.
// The payload is just the last row's id — F02's helpers cursor on it, and `created_at`
// ordering is stable enough for the MVP page (REFERENCE, Cursor pagination).
export const encodeCursor = (id: string): string => Buffer.from(id).toString('base64url');

// A hand-made `?cursor=` decodes to arbitrary bytes, and handing those to Prisma's `cursor`
// is a 500 off a query string. Anything not cuid-shaped is treated as no cursor — same
// clamp-don't-reject posture as `pageLimit`.
const CUID = /^[a-z0-9]{20,32}$/;

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
