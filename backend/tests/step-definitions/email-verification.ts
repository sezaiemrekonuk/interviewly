import { strict as assert } from 'node:assert';

import { Given, Then, When } from '@cucumber/cucumber';

import { redis } from '../../modules/auth/rate-limit';
import { mintEmailToken } from '../../modules/auth/tokens';
import { prisma } from '../../src/lib/db';

import { capturedText } from '../support/log-sink';
import { latestTokenFor, recordedJobs } from '../support/mail-recorder';
import type { AuthWorld, Exchange } from '../support/world';

const lower = (email: string) => email.trim().toLowerCase();

const userFor = (email: string) =>
  prisma.user.findUniqueOrThrow({ where: { email_lower: lower(email) } });

function errorCode(exchange: Exchange): string | undefined {
  return (exchange.body as { error?: { code?: string } } | undefined)?.error?.code;
}

// ------------------------------------------------------------------------------- Given

// Registers through the real endpoint rather than inserting a row: the scenarios about
// resending and confirming all start from the token registration itself issued, so a
// hand-built user would test a token no production path ever mints.
Given(
  'a registered unverified account exists for {string}',
  async function (this: AuthWorld, email: string) {
    await this.request('POST', '/auth/register', { body: { email, password: '1234567890' } });
    assert.equal(this.lastStatus, 201, 'registration fixture did not succeed');
    const user = await userFor(email);
    assert.equal(user.email_verified_at, null, 'a fresh registration must start unverified');
  },
);

Given(
  'a valid verification token was issued for {string}',
  function (this: AuthWorld, email: string) {
    const token = latestTokenFor(email);
    assert.ok(token, `no verification mail was queued for ${email}`);
    this.currentToken = token;
  },
);

Given(
  'a verification token was issued for {string} {int} hours ago',
  async function (this: AuthWorld, email: string, hours: number) {
    const user = await userFor(email);
    // Negative TTL through the same mint path, so the row under test is hashed and shaped
    // exactly like a real one — only its expiry is in the past.
    this.currentToken = await mintEmailToken(user.id, 'verify', { ttlMs: -hours * 60 * 60 * 1000 });
  },
);

// The two @AC-29 scenarios have no steps here on purpose. Their subject is the gate on
// `POST /interviews`, an endpoint I03 has not landed, and a step that stubbed it would
// assert against a route invented by this test file. The `auth` profile excludes @AC-29
// by tag until I03 lands; `requireVerifiedEmail` in `modules/auth/verify-email.ts` is the
// middleware those scenarios will exercise.

// -------------------------------------------------------------------------------- When

When('I confirm email verification with that token', async function (this: AuthWorld) {
  await this.request('POST', '/auth/verify-email/confirm', { body: { token: this.currentToken } });
});

When(
  'I confirm email verification with token {string}',
  async function (this: AuthWorld, token: string) {
    await this.request('POST', '/auth/verify-email/confirm', { body: { token } });
  },
);

When(
  'I confirm email verification with that token twice concurrently',
  async function (this: AuthWorld) {
    await this.requestConcurrently(2, 'POST', '/auth/verify-email/confirm', {
      body: { token: this.currentToken },
    });
  },
);

When('I request a verification resend', async function (this: AuthWorld) {
  await this.request('POST', '/auth/verify-email/request', { useSession: true });
});

// The cooldown is a Redis key with a TTL; dropping it is the honest way to model "60
// seconds passed" without either sleeping for a minute or letting the handler read a
// clock the test can move.
When(
  'the cooldown elapses and I request {int} verification resends',
  async function (this: AuthWorld, times: number) {
    for (let i = 0; i < times; i += 1) {
      const keys = await redis.keys('emailresend:cooldown:*');
      if (keys.length) await redis.del(...keys);
      await this.request('POST', '/auth/verify-email/request', { useSession: true });
    }
  },
);

// -------------------------------------------------------------------------------- Then

Then(
  'exactly one {string} job is enqueued for {string} with kind {string}',
  function (_queue: string, email: string, kind: string) {
    const matching = recordedJobs().filter((j) => j.to === lower(email) && j.kind === kind);
    assert.equal(matching.length, 1, `expected 1 ${kind} job, saw ${matching.length}`);
  },
);

Then('the current user has no verified email', function (this: AuthWorld) {
  const user = this.body<{ user: { emailVerifiedAt: string | null } }>().user;
  assert.equal(user.emailVerifiedAt, null);
});

Then(
  'the account for {string} has a verified email',
  async function (this: AuthWorld, email: string) {
    const user = await userFor(email);
    assert.ok(user.email_verified_at, `${email} is still unverified`);
  },
);

Then(
  'the account for {string} has no verified email',
  async function (this: AuthWorld, email: string) {
    const user = await userFor(email);
    assert.equal(user.email_verified_at, null);
  },
);

// The strongest available statement about leakage: the sink holds every field of every
// line the app emitted this scenario, so a token in any of them fails here.
Then('no log line contains the verification token', function () {
  const text = capturedText();
  const tokens = recordedJobs().map((j) => j.token);
  assert.ok(tokens.length > 0, 'no token was issued, so this assertion would prove nothing');
  for (const token of tokens) {
    assert.ok(!text.includes(token), 'a log line carried the plaintext token');
  }
  // The hash is not a link, but it is the lookup key: a leaked hash plus table access is
  // a working confirmation, so it is held to the same rule.
  assert.ok(!/[a-f0-9]{64}/.test(text), 'a log line carried something shaped like a token hash');
});

Then('exactly one response status is {int}', function (this: AuthWorld, status: number) {
  const matches = this.exchanges.filter((e) => e.status === status);
  assert.equal(matches.length, 1, `expected exactly one ${status}, saw ${matches.length}`);
});

Then('exactly one response error code is {string}', function (this: AuthWorld, code: string) {
  const matches = this.exchanges.filter((e) => errorCode(e) === code);
  assert.equal(matches.length, 1, `expected exactly one ${code}, saw ${matches.length}`);
});

Then('the response carries a cooldown of {int} seconds', function (this: AuthWorld, seconds: number) {
  assert.equal(this.body<{ cooldownSeconds: number }>().cooldownSeconds, seconds);
});

Then('the response carries the remaining cooldown seconds', function (this: AuthWorld) {
  const { cooldownSeconds } = this.body<{ cooldownSeconds: number }>();
  assert.equal(typeof cooldownSeconds, 'number');
  assert.ok(cooldownSeconds > 0, 'a cooldown refusal must say how long is left');
});

Then('the last response status is {int}', function (this: AuthWorld, status: number) {
  assert.equal(this.lastExchange().status, status);
});

Then('the last response error code is {string}', function (this: AuthWorld, code: string) {
  assert.equal(errorCode(this.lastExchange()), code);
});
