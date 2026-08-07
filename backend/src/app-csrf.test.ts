/**
 * Issue 67: `requirePublicOrigin` guarded the interview and voice routers only, so the auth
 * and me routers and `POST /uploads` accepted a state-changing request from any origin — a
 * `PATCH /me/profile` with `Origin: https://evil.example` returned 200 and wrote.
 *
 * `modules/interview/csrf.test.ts` covers what the guard *does*, over a hand-composed app.
 * That is exactly why it could not catch this: the guard worked perfectly on the two routers
 * that had it. What went missing was the mounting, so the mounting is what this asserts —
 * over the real routers and the real `app`, in two layers:
 *
 *  - structurally, that every browser-facing router mounts it router-WIDE (`.use`), which is
 *    the I05 property that makes a state-changing route added later covered by default;
 *  - over HTTP, that the paths the issue proved writable now refuse a foreign origin, and
 *    that the routes which must stay open — the HMAC webhooks, every GET — still are.
 *
 * Every request below stops in middleware, before any handler, so nothing here reads
 * Postgres or writes Redis. `ioredis` is faked only because `auth/rate-limit.ts` opens a
 * connection at import time. Like `modules/interview/csrf.test.ts`, this needs the env
 * `npm test` loads from `.env` — `env.ts` validates at import and exits on a missing key.
 */
import type { AddressInfo } from 'node:net';

import type { Router } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { config } from './lib/env';

// Hoisted above the imports, like `cucumber.js` does it and for the same reason: with
// `AI_ENABLED` on, the schema demands a real `ELEVENLABS_API_KEY`. Nothing here reaches a
// provider — the requests all stop in middleware.
vi.hoisted(() => {
  process.env.AI_ENABLED = 'false';
});

vi.mock('ioredis', () => ({ Redis: class { on() {} quit() {} } }));

const EVIL = 'https://evil.example';

/** Express 5 exposes neither of these; both are read off `stack` below. */
interface UseLayer {
  name: string;
  /** `true` for a pathless `use(fn)` — it matches every path. */
  slash: boolean;
  /** Compiled prefix matchers. Falsy return means this mount does not cover that path. */
  matchers: ((path: string) => unknown)[];
  route?: undefined;
}
interface RouteLayer {
  route: { path: string; stack: { method: string }[] };
}
type Layer = UseLayer | RouteLayer;

const stackOf = (router: Router): Layer[] => (router as unknown as { stack: Layer[] }).stack;

/**
 * A layer with no `route` came from `.use`; one with a `route` is a single path's handlers.
 * Per-route wiring would put the guard inside `layer.route` and fail this, which is the point.
 */
function hasGuardMount(router: Router): boolean {
  return stackOf(router).some((l) => !l.route && l.name === 'requirePublicOrigin');
}

/** `requirePublicOrigin` exempts these itself (csrf.ts), so they are not gaps. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Every state-changing route on `router` that no `requirePublicOrigin` mount above it
 * covers — the list this file wants empty.
 *
 * `hasGuardMount` alone cannot see this. Express 5.2.1 keeps a mount's path only inside
 * compiled closures (`layer.path` is undefined until a request is matching), so a scoped
 * `use('/me', guard)` and a pathless `use(guard)` look identical by name. `meRouter` is
 * mounted at `/` and therefore has to scope its guard to `/me` — which means "the guard is
 * mounted" stops implying "the guard covers the routes", and a `POST /profile/avatar` added
 * below it would be registered, reachable and unguarded while `hasGuardMount` stayed green.
 *
 * So this asks the mounts what they actually match. Order matters: a `use` registered after
 * a route does not run for it, so only guards seen earlier in the stack count.
 */
function unguardedStateChangingRoutes(router: Router): string[] {
  const guards: UseLayer[] = [];
  const gaps: string[] = [];

  for (const layer of stackOf(router)) {
    if (!layer.route) {
      if (layer.name === 'requirePublicOrigin') guards.push(layer);
      continue;
    }
    const methods = [...new Set(layer.route.stack.map((s) => s.method.toUpperCase()))].filter(
      (m) => !SAFE_METHODS.has(m),
    );
    if (methods.length === 0) continue;

    const path = layer.route.path;
    const covered = guards.some((g) => g.slash || g.matchers.some((match) => match(path)));
    if (!covered) gaps.push(`${methods.join(',')} ${path}`);
  }
  return gaps;
}

let baseUrl = '';
let server: { close: (cb: (e?: Error) => void) => void };

beforeAll(async () => {
  const { app } = await import('./app');
  const listening = app.listen(0);
  await new Promise((resolve) => listening.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
  server = listening;
});

afterAll(async () => {
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve(null))));
});

async function call(method: string, path: string, headers: HeadersInit = {}) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers, redirect: 'manual' });
  const body: unknown = await res.json().catch(() => undefined);
  return { status: res.status, code: (body as { error?: { code?: string } })?.error?.code };
}

const ROUTERS = [
  ['auth', () => import('../modules/auth/router').then((m) => m.default)],
  ['me', () => import('../modules/auth/router').then((m) => m.meRouter)],
  ['admin', () => import('../modules/admin/router').then((m) => m.default)],
  ['interview', () => import('../modules/interview/router').then((m) => m.default)],
  ['voice', () => import('../modules/voice/session').then((m) => m.default)],
  ['speech', () => import('../modules/speech/router').then((m) => m.default)],
] as const;

describe('every browser-facing router mounts the guard with .use', () => {
  it.each(ROUTERS)('%s', async (_name, load) => {
    expect(hasGuardMount(await load())).toBe(true);
  });
});

describe('and every state-changing route it carries is inside that mount', () => {
  it.each(ROUTERS)('%s', async (_name, load) => {
    expect(unguardedStateChangingRoutes(await load())).toEqual([]);
  });
});

/**
 * The routes the issue proved writable. They are all on routers whose guard sits above
 * `requireAuth` (or, for `/uploads`, above it in the chain), so an unauthenticated probe
 * reaches the guard and the refusal is unambiguously the origin check.
 *
 * The interview, voice and speech routers authenticate first and answer this same probe
 * `401 UNAUTHENTICATED`; their cross-site refusal *with* a session is covered by
 * `interview_flow.feature` @AC-15, which has one.
 */
const REFUSED: [method: string, path: string][] = [
  ['POST', '/auth/register'],
  ['POST', '/auth/login'],
  ['POST', '/auth/logout'],
  ['POST', '/auth/verify-email/request'],
  ['POST', '/auth/verify-email/confirm'],
  ['POST', '/auth/password-reset/request'],
  ['POST', '/auth/password-reset/confirm'],
  ['PATCH', '/me/profile'],
  ['POST', '/me/profile/complete'],
  ['DELETE', '/me'],
  ['POST', '/uploads'],
];

describe('a state-changing request from a foreign origin is refused', () => {
  it.each(REFUSED)('%s %s', async (method, path) => {
    expect(await call(method, path, { origin: EVIL })).toEqual({
      status: 403,
      code: 'CSRF_ORIGIN_MISMATCH',
    });
  });

  it.each(REFUSED)('%s %s with no Origin and no Referer', async (method, path) => {
    expect((await call(method, path)).code).toBe('CSRF_ORIGIN_MISMATCH');
  });

  it('lets the same request through when it carries PUBLIC_ORIGIN', async () => {
    expect((await call('PATCH', '/me/profile', { origin: config.PUBLIC_ORIGIN })).code).not.toBe(
      'CSRF_ORIGIN_MISMATCH',
    );
  });
});

describe('the guard leaves the routes it must not touch alone', () => {
  // Server-to-server: no Origin to check, HMAC instead (webhook-router.ts). `meRouter` is
  // mounted at `/`, so a pathless `use` on it — rather than the `/me` one — reaches these.
  it.each(['post_call', 'submit_answer', 'next_question', 'end_round'])(
    'POST /webhooks/elevenlabs/%s, no Origin',
    async (action) => {
      expect((await call('POST', `/webhooks/elevenlabs/${action}`)).code).not.toBe(
        'CSRF_ORIGIN_MISMATCH',
      );
    },
  );

  // GET is exempt by method, which is what keeps the SSE stream and the report download
  // working. These stop at `requireAuth` — reaching it is the proof the guard passed them.
  it.each([
    '/me',
    '/me/profile',
    '/me/interviews',
    '/me/questions',
    '/interviews/seed-interview/events',
    '/interviews/seed-interview/report/download',
    '/admin/interviews',
  ])('GET %s, no Origin', async (path) => {
    expect((await call('GET', path)).code).not.toBe('CSRF_ORIGIN_MISMATCH');
  });

  // The sign-in screen asks this before the visitor has any session (issue 60).
  it('leaves the public GET /auth/capabilities answerable', async () => {
    expect((await call('GET', '/auth/capabilities')).status).toBe(200);
  });
});
