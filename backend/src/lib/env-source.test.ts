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
