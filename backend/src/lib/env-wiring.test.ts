/**
 * Issue #117: three keys were declared, defaulted, documented and set in `.env` — and read by
 * nothing, because the value each one named was hardcoded elsewhere. `env-source.test.ts`
 * pins the *property* (no declared key is unread); this pins the two whose behaviour is not
 * already covered where it lives, by moving the env and watching the behaviour move with it.
 *
 * `config` is bound at module load, so each case re-imports under its own environment. That
 * is also the point: a value read once at import is exactly what a `.env` edit plus a restart
 * is supposed to change.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function withEnv<T>(env: Record<string, string>, load: () => Promise<T>): Promise<T> {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return load();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('SIGNED_URL_TTL', () => {
  it('is the ceiling a signed URL is capped to', async () => {
    const { cappedTtl, MAX_TTL_SECONDS } = await withEnv({ SIGNED_URL_TTL: '60' }, () =>
      import('./storage'),
    );

    expect(MAX_TTL_SECONDS).toBe(60);
    // Still a ceiling and not a default: a caller asking for more is cut down to it, a caller
    // asking for less keeps what it asked for.
    expect(cappedTtl(600)).toBe(60);
    expect(cappedTtl(30)).toBe(30);
  });

  // A present-but-empty key is what every unfilled `.env.example` line is, and
  // `z.coerce.number()` turns `''` into 0 — which, now that the key is live, would expire a
  // signed URL in one second. `emptyAsUnset` is what keeps the default reachable.
  it('falls back to the documented 300 when the key is present but empty', async () => {
    const { MAX_TTL_SECONDS } = await withEnv({ SIGNED_URL_TTL: '' }, () => import('./storage'));
    expect(MAX_TTL_SECONDS).toBe(300);
  });

  it.each([
    ['BUDGET_USD_TEXT', 0.5],
    ['MAX_INTERVIEWS_PER_USER_PER_DAY', 5],
    ['SESSION_TTL_DAYS', 7],
  ])('%s keeps its default when set to empty rather than collapsing to 0', async (key, fallback) => {
    const { config } = await withEnv({ [key]: '' }, () => import('./env'));
    expect(config[key as 'BUDGET_USD_TEXT']).toBe(fallback);
  });
});

describe('MAX_INTERVIEWS_PER_USER_PER_DAY', () => {
  it('is the limit the daily cap is built with', async () => {
    // The limiter is built at import; capturing its options is how the wiring is observed
    // without standing up Redis and burning 50 requests through it.
    const built: Array<{ prefix: string; limit: number }> = [];
    vi.doMock('../../modules/auth/rate-limit', () => ({
      keyedLimiter: (options: { prefix: string; limit: number }) => {
        built.push(options);
        return vi.fn();
      },
    }));

    await withEnv({ MAX_INTERVIEWS_PER_USER_PER_DAY: '50' }, () =>
      import('../../modules/interview/rate-limit'),
    );

    expect(built.find((options) => options.prefix === 'dailyinterview')?.limit).toBe(50);
    vi.doUnmock('../../modules/auth/rate-limit');
  });
});
