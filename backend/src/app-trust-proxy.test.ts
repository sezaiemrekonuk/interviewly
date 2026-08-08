/**
 * Issue 68: `app.set('trust proxy')` was never called, so `req.ip` was Caddy's container
 * address (`::ffff:172.18.0.9`) rather than the client's. Every IP-keyed limiter in A01 —
 * register 3/h, login 5/min, password-reset 5/h — collapsed into one global bucket: three
 * registrations from anywhere locked out every new signup on the internet for an hour, and
 * `RATE_LIMIT_HIT` logged the proxy instead of the attacker.
 *
 * `modules/auth/rate-limit.ts` has no bug to test — `byIp` reads `req.ip` and always did.
 * What was missing is app-level configuration, so the app is what this asserts, over the real
 * `app` and the real auth router: the same request from two client addresses must produce two
 * different Redis keys, and a client-supplied X-Forwarded-For must not let one client pick
 * its own key.
 *
 * `ioredis` is faked to record the keys and answer "over the limit", so every request stops
 * inside `keyedLimiter` — nothing here reaches Postgres or a real Redis. Like
 * `app-csrf.test.ts`, this needs the env `npm test` loads from `.env`.
 */
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from './lib/env';

// See app-csrf.test.ts: with `AI_ENABLED` on, the schema demands a real ElevenLabs key.
vi.hoisted(() => {
  process.env.AI_ENABLED = 'false';
});

const recorded = vi.hoisted(() => ({ keys: [] as string[] }));

// Enough of the client for `slidingWindowHit`: it records the key the limiter derived and
// reports a count past every limit, so the 429 comes back before any handler runs.
vi.mock('ioredis', () => ({
  Redis: class {
    on() {}
    quit() {}
    multi() {
      const chain = {
        zremrangebyscore: (key: string) => {
          recorded.keys.push(key);
          return chain;
        },
        zadd: () => chain,
        zcard: () => chain,
        pexpire: () => chain,
        exec: async () => [
          [null, 0],
          [null, 1],
          [null, 9_999],
          [null, 1],
        ],
      };
      return chain;
    }
  },
}));

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

beforeEach(() => {
  recorded.keys.length = 0;
});

/** Registers from `forwardedFor` (omitted = straight from the socket) and returns the key. */
async function registerKey(forwardedFor?: string): Promise<string> {
  const headers: Record<string, string> = { origin: config.PUBLIC_ORIGIN };
  if (forwardedFor !== undefined) headers['x-forwarded-for'] = forwardedFor;

  const res = await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers });
  const body = (await res.json()) as { error?: { code?: string } };
  // The limiter is the only thing that can answer this request; anything else means the
  // request slipped past it and the key below would be meaningless.
  expect({ status: res.status, code: body.error?.code }).toEqual({
    status: 429,
    code: 'RATE_LIMITED',
  });

  const key = recorded.keys.at(-1);
  expect(key).toBeDefined();
  return key!;
}

describe('the client address, not the proxy, keys an IP rate limit', () => {
  it('takes req.ip from the forwarded address Caddy sets', async () => {
    expect(await registerKey('203.0.113.10')).toBe('ratelimit:register:203.0.113.10');
  });

  it('gives two client addresses two separate buckets', async () => {
    expect([await registerKey('203.0.113.10'), await registerKey('203.0.113.11')]).toEqual([
      'ratelimit:register:203.0.113.10',
      'ratelimit:register:203.0.113.11',
    ]);
  });

  // The reason the setting is the hop count and not `true`: `true` walks to the left-most
  // entry, which is whatever the client typed, so an attacker could hand itself a fresh
  // bucket per request and never be limited at all.
  it('ignores a chain the client prepended to X-Forwarded-For', async () => {
    expect(await registerKey('9.9.9.9, 203.0.113.10')).toBe('ratelimit:register:203.0.113.10');
  });

  it('falls back to the socket address when no proxy header is present', async () => {
    expect(await registerKey()).toBe('ratelimit:register:::ffff:127.0.0.1');
  });

  it('is configured with the hop count, not `true`', async () => {
    const { app } = await import('./app');
    expect(app.get('trust proxy')).toBe(1);
  });
});
