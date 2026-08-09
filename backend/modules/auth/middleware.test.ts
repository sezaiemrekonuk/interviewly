/**
 * Issue #131: `requireAuth` slid the session window with an unconditional UPDATE, so every
 * `GET /me`, every room state poll and every SSE connect cost a write to move an expiry by
 * milliseconds — on a middleware mounted over effectively the whole authenticated surface.
 *
 * What must not change is the order of the refusals: a revoked or expired session is rejected
 * on the read, before anything is written. That is the property a "skip the write" optimisation
 * is most likely to break, so it is asserted alongside the write count.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionFindUnique = vi.fn();
const sessionUpdate = vi.fn(async () => ({}));
const userFindUnique = vi.fn(async () => ({ id: 'usr_1' }));

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    session = { findUnique: sessionFindUnique, update: sessionUpdate };
    user = { findUnique: userFindUnique };
  },
}));

const { requireAuth } = await import('./middleware');
const { SESSION_COOKIE, SESSION_SLIDE_THRESHOLD_MS, sessionExpiry } = await import(
  '../../src/lib/session'
);
const { ApiError } = await import('../../src/lib/api-error');

const MINUTE = 60 * 1000;

/** A session row whose expiry was last written `agoMs` ago. */
function storedSession(agoMs: number, over: Record<string, unknown> = {}) {
  return {
    id: 'tok',
    user_id: 'usr_1',
    revoked_at: null,
    // `sessionExpiry()` is always now + TTL, so a slide written `agoMs` ago stored exactly
    // that value minus `agoMs` — i.e. it sits `agoMs` behind what this request would write.
    expires_at: new Date(sessionExpiry().getTime() - agoMs),
    ...over,
  };
}

function call(session: unknown) {
  sessionFindUnique.mockResolvedValueOnce(session);
  const req = { cookies: { [SESSION_COOKIE]: 'tok' } } as never;
  const cookie = vi.fn();
  const res = { cookie } as never;
  const next = vi.fn();
  return { run: requireAuth(req, res, next), cookie, next };
}

describe('requireAuth session slide', () => {
  beforeEach(() => {
    sessionFindUnique.mockReset();
    sessionUpdate.mockReset();
    userFindUnique.mockClear();
  });

  it('writes nothing for a second request inside the threshold', async () => {
    const { run, cookie, next } = call(storedSession(MINUTE));
    await run;

    expect(next).toHaveBeenCalledWith();
    expect(sessionUpdate).not.toHaveBeenCalled();
    // No Set-Cookie either: refreshing the browser's copy while the row stands still would
    // put the two out of step.
    expect(cookie).not.toHaveBeenCalled();
  });

  it('slides once the stored expiry has fallen a threshold behind', async () => {
    const { run, cookie, next } = call(storedSession(SESSION_SLIDE_THRESHOLD_MS + MINUTE));
    await run;

    expect(next).toHaveBeenCalledWith();
    expect(sessionUpdate).toHaveBeenCalledTimes(1);
    const [args] = sessionUpdate.mock.calls[0] as unknown as [
      { where: { id: string }; data: { expires_at: Date } },
    ];
    expect(args.where.id).toBe('tok');
    expect(args.data.expires_at.getTime()).toBeGreaterThan(Date.now());
    expect(cookie).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['revoked', storedSession(SESSION_SLIDE_THRESHOLD_MS * 2, { revoked_at: new Date() })],
    ['expired', storedSession(0, { expires_at: new Date(Date.now() - MINUTE) })],
    ['unknown', null],
  ])('refuses a %s session on the read, before any write', async (_name, session) => {
    const { run, cookie, next } = call(session);
    await run;

    const [err] = next.mock.calls[0] as [unknown];
    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).code).toBe('UNAUTHENTICATED');
    expect(sessionUpdate).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
  });

  it('keeps the threshold inside the lifetime it slides', async () => {
    // A fixed hour would be most of the window under a short SESSION_TTL_DAYS, and a session
    // that cannot earn a slide before it expires is a session that logs an active user out.
    expect(SESSION_SLIDE_THRESHOLD_MS).toBeGreaterThan(0);
    expect(SESSION_SLIDE_THRESHOLD_MS).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});
