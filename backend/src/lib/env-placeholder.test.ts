/**
 * Issue #118: the running deployment's `.env` carried `.env.example`'s secrets byte for byte,
 * including the password of a seeded `admin@demo.com` whose `/admin` lists every interview on
 * the platform. `SESSION_SECRET`'s placeholder is exactly 32 characters, so the `min(32)` that
 * was supposed to catch an unset secret passed it without a word.
 *
 * Asserted over the schema rather than over a boot: `env.ts` calls `process.exit(1)` on a
 * validation failure, so a test that imported it under a bad env would take the runner with it.
 *
 * The rule is gated on `NODE_ENV=production` on purpose, and both halves of that are pinned
 * below. `cp .env.example .env` is the documented first boot (AGENTS.md) and what all three CI
 * jobs do, so an unconditional refusal would red-light CI by construction — production is the
 * only environment where the placeholder is a live credential rather than a template.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PLACEHOLDER_PREFIX, schema } from './env';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

/** `.env.example` is the template every deployment starts from, so it is the fixture. */
const exampleEnv = (): Record<string, string> =>
  Object.fromEntries(
    readFileSync(join(repoRoot, '.env.example'), 'utf8')
      .split('\n')
      .flatMap((line) => {
        const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
        return match ? [[match[1], match[2].replace(/^"|"$/g, '')] as [string, string]] : [];
      }),
  );

const failedKeys = (env: Record<string, string>): string[] => {
  const result = schema.safeParse(env);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('SESSION_SECRET placeholder', () => {
  it('is still long enough to satisfy min(32) on its own', () => {
    // The reason the bug was invisible. If this ever fails the placeholder was shortened and
    // the refine below is no longer the only thing standing between it and a deployment.
    expect(exampleEnv().SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('fails validation under NODE_ENV=production, naming the key', () => {
    expect(failedKeys({ ...exampleEnv(), NODE_ENV: 'production' })).toContain('SESSION_SECRET');
  });

  it('passes once the secret is rotated', () => {
    const rotated = {
      ...exampleEnv(),
      NODE_ENV: 'production',
      SESSION_SECRET: 'b8f3c1a9e07d4256b1fa93c8e5d2740a',
    };

    expect(failedKeys(rotated)).not.toContain('SESSION_SECRET');
  });

  it('does not refuse the placeholder in development, so `cp .env.example .env` still boots', () => {
    expect(failedKeys(exampleEnv())).toEqual([]);
  });

  it('catches any `change-me` secret, not the one string shipped today', () => {
    const renamed = {
      ...exampleEnv(),
      NODE_ENV: 'production',
      SESSION_SECRET: `${PLACEHOLDER_PREFIX}-something-else-entirely-here`,
    };

    expect(failedKeys(renamed)).toContain('SESSION_SECRET');
  });
});
