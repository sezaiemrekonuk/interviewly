/**
 * Issue 142: `storage.ts` built both S3 clients with `process.env.S3_REGION ?? 'us-east-1'`,
 * so the one input the schema did not declare was also the one nothing validated. Against
 * MinIO that is invisible — it ignores the region — but on real S3 a typo fails at request
 * time with an opaque SDK error instead of at boot with a schema message, and no operator
 * reading `env.ts` or `.env.example` could learn the knob existed.
 *
 * Asserting `config.S3_REGION` alone would not catch the bug coming back: a client that reads
 * `process.env` again still passes it. What the issue actually asks for is a property — every
 * environment input the service reads is declared in one validated schema — so that property
 * is what the second test pins, over the source of `src/lib` rather than over one call site.
 * `env.ts` is the sanctioned reader; `prisma/seed.ts` is deliberately out of scope and says
 * why at the top of the file (an ops tool must not need SESSION_SECRET to seed a bucket).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { config } from './env';

describe('S3_REGION', () => {
  it('resolves through the validated config', () => {
    expect(config.S3_REGION).toBeTypeOf('string');
    expect(config.S3_REGION.length).toBeGreaterThan(0);
  });
});

describe('src/lib environment access', () => {
  it('reads process.env in env.ts only', () => {
    const dir = __dirname;

    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
      );

    const offenders = walk(dir)
      .filter((p) => (p.endsWith('.ts') || p.endsWith('.js')))
      .filter((p) => !p.endsWith('.test.ts') && !p.endsWith('.test.js'))
      .filter((p) => p !== join(dir, 'env.ts') && p !== join(dir, 'env.js'))
      .filter((p) => /process\.env\b/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(dir, p));

    expect(offenders).toEqual([]);
  });
});

/**
 * Issue #117's fourth criterion, and the property that keeps the other three from rotting:
 * `MAX_INTERVIEWS_PER_USER_PER_DAY`, `BUDGET_USD_TEXT` and `SIGNED_URL_TTL` were declared,
 * defaulted, documented and set in `.env` — and read by nothing, because the value each one
 * names was hardcoded somewhere else. A knob that silently does nothing is worse than a
 * missing one: an operator raises a limit, sees no error, and finds out in front of an
 * audience.
 *
 * A key counts as read if anything outside the declaration reaches for it — `config.KEY`
 * (the sanctioned path), `process.env.KEY` (the two ops tools that must not need the whole
 * schema to run), or `env("KEY")` in the Prisma schema, which is how the datasource is wired.
 */
describe('every declared env key has a reader', () => {
  const REPO = join(__dirname, '..', '..', '..');

  /** Sources that may legitimately consume config, minus the schema that declares it. */
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.next') return [];
      const full = join(d, e.name);
      return e.isDirectory() ? walk(full) : [full];
    });

  it('is read somewhere other than the schema that declares it', () => {
    const envSource = readFileSync(join(__dirname, 'env.ts'), 'utf8');
    // The keys as declared: `  KEY:` at the head of a schema line.
    const declared = [...envSource.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(20);

    const consumers = [
      ...walk(join(REPO, 'backend')),
      ...walk(join(REPO, 'worker')),
      ...walk(join(REPO, 'packages')),
    ]
      .filter((p) => /\.(ts|tsx|prisma)$/.test(p))
      .filter((p) => p !== join(__dirname, 'env.ts'))
      .map((p) => readFileSync(p, 'utf8'));

    const dead = declared.filter((key) => {
      const reader = new RegExp(`(config\\.${key}\\b|process\\.env\\.${key}\\b|env\\("${key}"\\))`);
      return !consumers.some((source) => reader.test(source));
    });

    expect(dead).toEqual([]);
  });
});
