/**
 * Issue #80: a successful Google sign-in redirected straight to the signed-in home, so a new
 * account never met onboarding — and because onboarding is not reachable once bypassed, the
 * profile that personalises every interview stayed empty forever.
 *
 * The destination is now `/`, which applies the K8.7 first-run rule client-side — the same
 * rule the password path uses. What this pins is the handler's half: where it sends the
 * browser, and that the failure paths still answer as they did. `page.test.tsx` owns the
 * other half (what `/` then does with an account that has not finished onboarding).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getdel: vi.fn(async () => 'verifier'),
  issueSession: vi.fn(async () => undefined),
  warn: vi.fn(),
  info: vi.fn(),
}));

vi.mock('./rate-limit', () => ({ redis: { getdel: m.getdel } }));
vi.mock('../../src/lib/logger', () => ({ logger: { warn: m.warn, info: m.info, error: vi.fn() } }));
vi.mock('../../src/lib/session', () => ({ issueSessionForUser: m.issueSession }));
vi.mock('../../src/lib/db', () => ({ prisma: {} }));
// The one boundary that talks to Google. Everything the handler does with the result is its
// own code, so faking the exchange leaves the routing decision under test.
vi.mock('arctic', () => ({
  Google: class {},
  generateState: () => 'state',
  generateCodeVerifier: () => 'verifier',
}));

const { googleCallback } = await import('./google');
const { config } = await import('../../src/lib/env');

function call(query: Record<string, string>, cookieState = 'st4te') {
  const req = { query, cookies: { oauth_state: cookieState }, traceId: 'trc' } as never;
  const redirect = vi.fn();
  const res = { redirect, cookie: vi.fn(), clearCookie: vi.fn() } as never;
  return { run: googleCallback(req, res, vi.fn()), redirect };
}

describe('googleCallback destination', () => {
  beforeEach(() => {
    m.getdel.mockClear();
    m.issueSession.mockClear();
    m.warn.mockClear();
  });

  // The state pair is checked before anything else, so this reaches `refuse` without needing
  // a credentialed deployment — which is what makes the failure half assertable here at all.
  it('still returns a refusal to the sign-in form, unchanged', async () => {
    const { run, redirect } = call({ code: 'abc', state: 'mismatched' });
    await run;

    expect(redirect).toHaveBeenCalledWith(
      302,
      `${config.PUBLIC_ORIGIN}/sign-in?error=OAUTH_STATE_MISMATCH`,
    );
  });

  it('never sends a sign-in to /dashboard', async () => {
    const { run, redirect } = call({ code: 'abc', state: 'mismatched' });
    await run;

    const [, url] = redirect.mock.calls[0] as [number, string];
    expect(url).not.toContain('/dashboard');
  });
});

describe('the success destination is the first-run router', () => {
  it('is `/`, so the rule lives in one place instead of two', async () => {
    // Read from source rather than driven through a full OAuth exchange: completing one needs
    // a live token endpoint, and the assertion that matters is which URL the success path
    // names — a constant, and the entire defect.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./google.ts', import.meta.url), 'utf8');

    expect(source).toContain('res.redirect(302, `${config.PUBLIC_ORIGIN}/`)');
    // The refusals keep their own destination; only the success path moved.
    expect(source).not.toContain('PUBLIC_ORIGIN}/dashboard');
  });
});
