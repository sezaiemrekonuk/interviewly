/**
 * Issue #120: four endpoint groups had no rate limit at all. Three of them are fixed by adding
 * a middleware to a route, which is exactly the kind of change that comes back — a route
 * rewritten, a middleware dropped in a merge, and nothing fails because a missing limiter has
 * no symptom until someone looks for one.
 *
 * So this pins the mounts rather than the limiting. `keyedLimiter` itself is covered by
 * `app-trust-proxy.test.ts` (which drives real requests through it) and by the acceptance
 * ring; what is asserted here is that the routes still carry it, and — for `/uploads` — that
 * it sits AHEAD of multer.
 *
 * That ordering is the substance of the fix, not a detail. `POST /uploads` accepts 10 MB and
 * parses up to 30 PDF pages; a limiter mounted after `uploadMiddleware` would answer 429 only
 * once the body it is refusing had already been buffered, which is most of the cost the cap
 * exists to refuse.
 *
 * Compared by identity, not by name: `keyedLimiter` returns an anonymous arrow, so every
 * limiter in the stack is `''` and a name-based assertion would pass against the wrong one.
 *
 * Like `app-trust-proxy.test.ts`, this needs the env `npm test` loads from `.env`, and fakes
 * `ioredis` so importing the app opens no connection.
 */
import type { RequestHandler } from 'express';
import { describe, expect, it, vi } from 'vitest';

// See app-csrf.test.ts: with `AI_ENABLED` on, the schema demands a real ElevenLabs key.
vi.hoisted(() => {
  process.env.AI_ENABLED = 'false';
});

vi.mock('ioredis', () => ({
  Redis: class {
    on() {}
    quit() {}
    duplicate() {
      return new (this.constructor as new () => unknown)();
    }
  },
}));

const { app } = await import('./app');
const { uploadLimiter } = await import('../modules/interview/rate-limit');
const { tokenConfirmLimiter } = await import('../modules/auth/rate-limit');
const { uploadMiddleware } = await import('../modules/interview/uploads');

interface Layer {
  name: string;
  handle: RequestHandler;
  route?: { path: string; stack: Layer[] };
}

/** The handler chain a method+path resolves to, in mount order. */
function chainFor(path: string, router: { stack: Layer[] } = app.router): RequestHandler[] {
  const layer = router.stack.find((l) => l.route?.path === path);
  if (!layer?.route) throw new Error(`no route mounted at ${path}`);
  return layer.route.stack.map((l) => l.handle);
}

/** The auth router is mounted under `/auth`, so its own paths are relative. */
function authChainFor(path: string): RequestHandler[] {
  const mount = app.router.stack.find(
    (l: Layer & { handle: { stack?: Layer[] } }) =>
      l.name === 'router' && l.handle.stack?.some((s) => s.route?.path === path),
  ) as (Layer & { handle: { stack: Layer[] } }) | undefined;
  if (!mount) throw new Error(`no router mounted carrying ${path}`);
  return chainFor(path, mount.handle);
}

describe('POST /uploads', () => {
  it('carries the per-user upload limiter', () => {
    expect(chainFor('/uploads')).toContain(uploadLimiter);
  });

  it('refuses before multer buffers the body', () => {
    const chain = chainFor('/uploads');

    expect(chain.indexOf(uploadLimiter)).toBeLessThan(chain.indexOf(uploadMiddleware));
  });
});

describe('single-use-token confirms', () => {
  // The request halves were limited and these two were not — and one of them rotates a
  // password, so unlimited attempts is unlimited guessing against a single-use token.
  it.each(['/verify-email/confirm', '/password-reset/confirm'])('%s is limited', (path) => {
    expect(authChainFor(path)).toContain(tokenConfirmLimiter);
  });
});
