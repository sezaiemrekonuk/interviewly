/**
 * `requirePublicOrigin` is mounted once with `router.use`, not per route (I05 non-negotiable),
 * so these assert the two properties that mounting makes load-bearing and that
 * `interview_flow.feature` @AC-15 — a single POST pair — cannot reach:
 *
 *  - a router-wide guard must let `GET` through untouched, or the SSE stream and
 *    `/report/download` break;
 *  - the guard must run before `router.param`, so a rejected cross-site request never
 *    reaches the ownership resolver's DB read.
 *
 * The app here mirrors `router.ts`'s composition rather than importing it: the real router
 * pulls in `requireAuth`, Prisma and Redis, which the acceptance suite already covers over
 * real HTTP. What is under test is the composition itself.
 */
import type { AddressInfo } from 'node:net';

import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiError, httpStatusFor } from '../../src/lib/api-error';
import { config } from '../../src/lib/env';

import { requirePublicOrigin } from './csrf';

const EVIL = 'https://evil.example';

/** Ids the `param` callback was reached for — empty means the guard rejected first. */
const resolved: string[] = [];

const app = express();
app.use(requirePublicOrigin);
app.param('id', (req, _res, next, id: string) => {
  resolved.push(id);
  next();
});
app.get('/:id/state', (_req, res) => void res.json({ ok: true }));
app.post('/:id/profile', (_req, res) => void res.json({ ok: true }));
app.use(((err, _req, res, _next) => {
  const code = err instanceof ApiError ? err.code : 'INTERNAL_ERROR';
  res.status(err instanceof ApiError ? httpStatusFor(err.code) : 500).json({ error: { code } });
}) satisfies express.ErrorRequestHandler);

let baseUrl = '';
let server: ReturnType<typeof app.listen>;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve(null))));
});

async function call(method: 'GET' | 'POST', path: string, headers: HeadersInit = {}) {
  resolved.length = 0;
  const res = await fetch(`${baseUrl}${path}`, { method, headers });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

describe('requirePublicOrigin mounted router-wide', () => {
  it('lets GET through with no Origin at all', async () => {
    expect(await call('GET', '/abc/state')).toEqual({ status: 200, body: { ok: true } });
  });

  it('rejects a state-changing request whose Origin is not PUBLIC_ORIGIN', async () => {
    expect(await call('POST', '/abc/profile', { origin: EVIL })).toEqual({
      status: 403,
      body: { error: { code: 'CSRF_ORIGIN_MISMATCH' } },
    });
  });

  it('falls back to Referer and compares its origin, not the whole URL', async () => {
    expect((await call('POST', '/abc/profile', { referer: `${EVIL}/page` })).status).toBe(403);
    expect(
      (await call('POST', '/abc/profile', { referer: `${config.PUBLIC_ORIGIN}/room/abc` })).status,
    ).toBe(200);
  });

  it('fails closed when both Origin and Referer are absent', async () => {
    expect((await call('POST', '/abc/profile')).status).toBe(403);
  });

  it('treats an unparseable Origin as a mismatch', async () => {
    expect((await call('POST', '/abc/profile', { origin: 'null' })).status).toBe(403);
  });

  it('rejects before the ownership resolver runs, so nothing is read or written', async () => {
    await call('POST', '/abc/profile', { origin: EVIL });
    expect(resolved).toEqual([]);
  });

  it('reaches the resolver once the origin matches', async () => {
    await call('POST', '/abc/profile', { origin: config.PUBLIC_ORIGIN });
    expect(resolved).toEqual(['abc']);
  });
});
