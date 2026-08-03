import { strict as assert } from 'node:assert';

import { Given, Then, When } from '@cucumber/cucumber';

import { resetMailSettled } from '../../modules/auth/password-reset';
import { mintEmailToken } from '../../modules/auth/tokens';
import { prisma } from '../../src/lib/db';

import { capturedLines, capturedText } from '../support/log-sink';
import { latestTokenFor, recordedJobs } from '../support/mail-recorder';
import type { AuthWorld } from '../support/world';

const lower = (email: string) => email.trim().toLowerCase();

const userFor = (email: string) =>
  prisma.user.findUniqueOrThrow({ where: { email_lower: lower(email) } });

/**
 * `POST /auth/password-reset/request` answers before it decides whether to send anything —
 * that is the whole anti-enumeration design (K8.6), not an implementation detail. So a step
 * that asserts on the enqueue has to join the work the handler left running; `resetMailSettled`
 * is that join point. Polling instead would make every "no job was enqueued" assertion a race.
 */
async function requestReset(world: AuthWorld, email: string): Promise<void> {
  await world.request('POST', '/auth/password-reset/request', { body: { email } });
  await resetMailSettled();
}

// ------------------------------------------------------------------------------- Given

Given('no account exists for {string}', async function (this: AuthWorld, email: string) {
  assert.equal(await prisma.user.count({ where: { email_lower: lower(email) } }), 0);
});

// `password_hash` null is what makes this account Google-only, and `email_verified_at` null
// is the state A02 leaves behind when Google reports the address unverified — the case the
// reset path has to be able to verify.
Given('a Google-only account exists for {string}', async function (this: AuthWorld, email: string) {
  await prisma.user.create({
    data: { email_lower: lower(email), google_sub: `google-${lower(email)}` },
  });
});

Given('I am signed in as {string}', async function (this: AuthWorld, email: string) {
  const password = this.passwords.get(lower(email));
  assert.ok(password, `no fixture password recorded for ${email}`);
  await this.request('POST', '/auth/login', { body: { email, password } });
  assert.equal(this.lastStatus, 200, 'sign-in fixture did not succeed');
});

// Through the real endpoint, so the token under test is one the production path minted and
// handed to the mail job — not one the test invented.
Given('a valid reset token was issued for {string}', async function (this: AuthWorld, email: string) {
  await requestReset(this, email);
  const token = latestTokenFor(email);
  assert.ok(token, `no reset mail was queued for ${email}`);
  this.currentToken = token;
});

Given(
  'a reset token was issued for {string} {int} minutes ago',
  async function (this: AuthWorld, email: string, minutes: number) {
    const user = await userFor(email);
    this.currentToken = await mintEmailToken(user.id, 'reset', { ttlMs: -minutes * 60 * 1000 });
  },
);

// -------------------------------------------------------------------------------- When

When('I request a password reset for {string}', async function (this: AuthWorld, email: string) {
  await requestReset(this, email);
});

When(
  'I request {int} password resets for {string}',
  async function (this: AuthWorld, times: number, email: string) {
    for (let i = 0; i < times; i += 1) await requestReset(this, email);
  },
);

When(
  'I confirm the password reset with that token and password {string}',
  async function (this: AuthWorld, password: string) {
    await this.request('POST', '/auth/password-reset/confirm', {
      body: { token: this.currentToken, password },
    });
  },
);

// -------------------------------------------------------------------------------- Then

// Byte-identical is the requirement, so an empty body means no body at all — not `{}`, which
// would still be a place for a future field to leak whether the account existed.
Then('the response body is empty', function (this: AuthWorld) {
  assert.equal(this.lastBody, undefined);
});

Then('no {string} job is enqueued for {string}', function (_queue: string, email: string) {
  const matching = recordedJobs().filter((j) => j.to === lower(email));
  assert.equal(matching.length, 0, `expected no job for ${email}, saw ${matching.length}`);
});

Then(
  'a log event {string} was emitted with the user id',
  function (this: AuthWorld, event: string) {
    const line = capturedLines().find((l) => l.event === event);
    assert.ok(line, `no ${event} line was emitted`);
    assert.equal(typeof line.fields.userId, 'string');
  },
);

Then('no log line contains the reset token', function (this: AuthWorld) {
  const tokens = [this.currentToken, ...recordedJobs().map((j) => j.token)].filter(
    (t): t is string => typeof t === 'string',
  );
  assert.ok(tokens.length > 0, 'no token was issued, so this assertion would prove nothing');
  const text = capturedText();
  for (const token of tokens) {
    assert.ok(!text.includes(token), 'a log line carried a plaintext reset token');
  }
});

// The hash is not a link, but it is the lookup key: a leaked hash plus table access is a
// working reset, so it is held to the same rule as the token.
Then('no log line contains a token hash', function () {
  assert.ok(
    !/[a-f0-9]{64}/.test(capturedText()),
    'a log line carried something shaped like a token hash',
  );
});
