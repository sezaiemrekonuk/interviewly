/**
 * The predicate two security guards read (issue #118): `env.ts` refuses the placeholder
 * secret, and `prisma/seed.ts` refuses to create the demo admin. Both are only as good as
 * this answer, and both would fail open — booting, seeding — if it said "local" too readily.
 *
 * So the local side is the side that is enumerated. A false "deployed" is a boot failure
 * someone fixes in ten seconds; a false "local" is issue #118 again.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isDeployed, isLocalOrigin } from './deployment';

describe('isDeployed', () => {
  it('takes NODE_ENV=production at its word whatever the origin says', () => {
    expect(isDeployed('production', 'http://localhost')).toBe(true);
  });

  // The review finding on #268. `.env.example` carries `NODE_ENV=development` on its own
  // line, so shipping the file whole — the incident — keeps that value. The origin is what
  // the deployment had to change for anything to work.
  it('reports a deployed origin even when NODE_ENV was left at development', () => {
    expect(isDeployed('development', 'https://interviewly.example.com')).toBe(true);
  });

  it.each([
    ['http://localhost', 'the .env.example value'],
    ['http://localhost:3000', 'a dev server port'],
    ['http://127.0.0.1', 'loopback by address'],
    ['http://127.0.0.1:4000', 'loopback with the API port'],
    ['http://[::1]', 'IPv6 loopback'],
    ['https://localhost', 'TLS in front of a local stack'],
    ['http://localhost/', 'a trailing slash'],
    ['HTTP://LOCALHOST', 'upper case'],
  ])('treats %s as local (%s)', (origin) => {
    expect(isDeployed('development', origin)).toBe(false);
    expect(isLocalOrigin(origin)).toBe(true);
  });

  it.each([
    'https://interviewly.example.com',
    'https://staging.interviewly.example.com',
    'http://192.168.1.40',
    'https://localhost.evil.example.com',
    'https://notlocalhost',
  ])('treats %s as deployed', (origin) => {
    expect(isDeployed('development', origin)).toBe(true);
  });

  // `env.ts` already fails on a missing PUBLIC_ORIGIN by its own rule. Reporting "deployed"
  // here would add a second failure naming SESSION_SECRET and bury the one that matters.
  it.each([undefined, '', '   '])('reports %p as not deployed, leaving the url rule to speak', (origin) => {
    expect(isDeployed('development', origin)).toBe(false);
  });

  it('still reports production when the origin is missing', () => {
    expect(isDeployed('production', undefined)).toBe(true);
  });
});

/**
 * The seed's guard cannot be driven from here — `prisma/seed.ts` builds a Prisma client and an
 * S3 client at import, and the production image has no `tsx` to run it with — so the wiring is
 * what gets pinned instead.
 *
 * This is narrow on purpose: it does not claim the seed behaves correctly, only that it still
 * asks the question the tests above answer. The regression it exists for is someone
 * simplifying the call back to a bare `NODE_ENV === 'production'`, which is the exact shape
 * review on #268 rejected and which no other assertion in the suite would notice.
 */
describe('prisma/seed.ts gates the demo admin on this predicate', () => {
  const source = readFileSync(
    join(__dirname, '..', '..', 'prisma', 'seed.ts'),
    'utf8',
  );

  it('calls isDeployed with both inputs', () => {
    expect(source).toMatch(/isDeployed\(\s*process\.env\.NODE_ENV,\s*process\.env\.PUBLIC_ORIGIN\s*\)/);
  });

  it('does not decide on NODE_ENV alone', () => {
    expect(source).not.toMatch(/process\.env\.NODE_ENV\s*===\s*'production'/);
  });
});
