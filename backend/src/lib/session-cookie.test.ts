/**
 * Issue #69: `SESSION_COOKIE_SECURE` and `SESSION_TTL_DAYS` were declared, documented and set
 * in `.env`, and read by nothing — `Secure` came off `NODE_ENV` and the TTL was a hardcoded
 * seven days. The lie was operational (an operator hardens a deployment and nothing happens)
 * and, on a TLS box whose container inherited `NODE_ENV=development`, a real one: the session
 * cookie went out without `Secure`.
 *
 * The config is read at module load, so each case re-imports the module under its own env
 * rather than mutating one already-bound value — which is also what proves the read is not
 * cached somewhere it should not be.
 */
import type { Response } from 'express';

import { afterEach, describe, expect, it, vi } from 'vitest';

interface CookieCall {
  name: string;
  value: string;
  options: { secure?: boolean; maxAge?: number; httpOnly?: boolean; sameSite?: string };
}

/** A `Response` that records `res.cookie(...)` instead of writing a header. */
function recorder(): { res: Response; calls: CookieCall[] } {
  const calls: CookieCall[] = [];
  const res = {
    cookie: (name: string, value: string, options: CookieCall['options']) => {
      calls.push({ name, value, options });
    },
  } as unknown as Response;
  return { res, calls };
}

async function sessionWith(env: Record<string, string>) {
  vi.resetModules();
  // A case that stubs NODE_ENV=production inherits the rest of its environment from `.env`,
  // whose SESSION_SECRET is the `change-me` placeholder — which env.ts refuses in production
  // since issue #118, exiting the runner before the cookie under test is ever built. Stubbed
  // rather than exempted: these cases want a production-*shaped* environment, and a real
  // secret is part of that shape.
  vi.stubEnv('SESSION_SECRET', 'f4c1b90e7a2d63581cfe04ab29d7melon');
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import('./session');
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('session cookie options', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('takes Secure from the setting, not from NODE_ENV', async () => {
    // The combination the issue found in the wild: not production, but served over TLS.
    const { issueCookie } = await sessionWith({
      NODE_ENV: 'development',
      SESSION_COOKIE_SECURE: 'true',
    });
    const { res, calls } = recorder();
    issueCookie(res, 'tok');

    expect(calls[0].options.secure).toBe(true);
  });

  it('omits Secure when the setting says so, so local HTTP sign-in still works', async () => {
    const { issueCookie } = await sessionWith({
      NODE_ENV: 'production',
      SESSION_COOKIE_SECURE: 'false',
    });
    const { res, calls } = recorder();
    issueCookie(res, 'tok');

    expect(calls[0].options.secure).toBe(false);
  });

  it('sizes both the cookie and the row expiry from SESSION_TTL_DAYS', async () => {
    const { issueCookie, sessionExpiry } = await sessionWith({ SESSION_TTL_DAYS: '1' });
    const { res, calls } = recorder();
    issueCookie(res, 'tok');

    expect(calls[0].options.maxAge).toBe(DAY_MS);
    // The cookie and the `sessions.expires_at` it maps to must not drift apart.
    const expiry = sessionExpiry().getTime() - Date.now();
    expect(expiry).toBeGreaterThan(DAY_MS - 5_000);
    expect(expiry).toBeLessThanOrEqual(DAY_MS);
  });

  it('keeps the untouched flags, and clears through the same options', async () => {
    const { issueCookie, revokeCookie, SESSION_COOKIE } = await sessionWith({
      SESSION_COOKIE_SECURE: 'true',
    });
    const { res, calls } = recorder();
    issueCookie(res, 'tok');
    revokeCookie(res);

    for (const call of calls) {
      expect(call.name).toBe(SESSION_COOKIE);
      expect(call.options).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true });
    }
    // The clear is the same cookie with the same attributes and no lifetime — a browser only
    // drops a cookie when the replacement matches on more than name.
    expect(calls[1].value).toBe('');
    expect(calls[1].options.maxAge).toBe(0);
  });
});
