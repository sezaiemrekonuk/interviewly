/**
 * The gate's DENY path is the one @AC-17 never reaches — that scenario only ever signs in
 * the admin. @AC-18 asserts it over HTTP, but that scenario is N02's and is still
 * `@unwired`, so without these the trust boundary would ship on an untested branch.
 *
 * Composed here rather than importing `router.ts`, which drags in Prisma and Redis: what is
 * under test is that `router.use` puts the gate ahead of every route, including ones added
 * later (ADR-N01).
 */
import type { AddressInfo } from 'node:net';

import express, { Router } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiError, httpStatusFor } from '../../src/lib/api-error';

import { requireAdmin } from './middleware';

/** Stands in for A01's `requireAuth`: `?role=` picks who the session resolved to. */
const fakeAuth: express.RequestHandler = (req, _res, next) => {
  const role = req.query.role;
  if (typeof role === 'string') req.user = { id: 'u1', role } as never;
  next();
};

const admin = Router();
admin.use(fakeAuth, requireAdmin);
admin.get('/interviews', (_req, res) => void res.json({ ok: true }));
// Stands in for the route N02 mounts below the slot comment: it inherits the gate without
// naming it, which is the property `router.use` buys.
admin.get('/stats', (_req, res) => void res.json({ ok: true }));

const app = express();
app.use('/admin', admin);
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

const call = async (path: string) => {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json().catch(() => undefined) };
};

const FORBIDDEN = { status: 403, body: { error: { code: 'FORBIDDEN' } } };

describe('requireAdmin mounted router-wide', () => {
  it('lets an admin through', async () => {
    expect(await call('/admin/interviews?role=admin')).toEqual({ status: 200, body: { ok: true } });
  });

  it('rejects a signed-in non-admin with FORBIDDEN, not 404', async () => {
    expect(await call('/admin/interviews?role=user')).toEqual(FORBIDDEN);
  });

  // The failure mode a cheaper model reproduces: passing `req.user` through on truthiness
  // rather than asserting the role.
  it('rejects when no user was resolved at all', async () => {
    expect(await call('/admin/interviews')).toEqual(FORBIDDEN);
  });

  it("rejects a role that merely contains 'admin'", async () => {
    expect(await call('/admin/interviews?role=administrator')).toEqual(FORBIDDEN);
    expect(await call('/admin/interviews?role=notadmin')).toEqual(FORBIDDEN);
  });

  it('covers a route mounted after the gate without restating it', async () => {
    expect(await call('/admin/stats?role=user')).toEqual(FORBIDDEN);
    expect(await call('/admin/stats?role=admin')).toEqual({ status: 200, body: { ok: true } });
  });
});
