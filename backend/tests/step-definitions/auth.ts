import { strict as assert } from 'node:assert';

import { hash } from '@node-rs/argon2';
import { Given, Then, When } from '@cucumber/cucumber';

import { prisma } from '../../src/lib/db';

import type { AuthWorld } from '../support/world';

const lower = (email: string) => email.trim().toLowerCase();

const DEFAULT_FIXTURE_PASSWORD = 'Password123!';

Given('a password account exists for {string}', async function (this: AuthWorld, email: string) {
  await prisma.user.create({
    data: { email_lower: lower(email), password_hash: await hash(DEFAULT_FIXTURE_PASSWORD) },
  });
  this.passwords.set(lower(email), DEFAULT_FIXTURE_PASSWORD);
});

Given(
  'a password account exists for {string} with password {string}',
  async function (this: AuthWorld, email: string, password: string) {
    await prisma.user.create({
      data: { email_lower: lower(email), password_hash: await hash(password) },
    });
    this.passwords.set(lower(email), password);
  },
);

Given(
  'an account with the admin role exists for {string} with password {string}',
  async function (this: AuthWorld, email: string, password: string) {
    await prisma.user.create({
      data: { email_lower: lower(email), password_hash: await hash(password), role: 'admin' },
    });
  },
);

// Drives the NODE_ENV=test seam, which runs the same linking/restriction code as the real
// callback minus Google's redirect and token exchange.
When(
  'Google sign-in completes for {string} with email_verified {word}',
  async function (this: AuthWorld, email: string, verified: string) {
    await this.request('POST', '/test/auth/simulate-google-callback', {
      body: { email, email_verified: verified === 'true' },
    });
  },
);

When(
  'I register with email {string} and password {string}',
  async function (this: AuthWorld, email: string, password: string) {
    // Consent is part of a normal registration (issue 009); the refusal path has its own
    // step in `account-erasure.ts`, which omits the field on purpose.
    await this.request('POST', '/auth/register', { body: { email, password, consent: true } });
  },
);

When(
  'I log in with email {string} and password {string}',
  async function (this: AuthWorld, email: string, password: string) {
    await this.request('POST', '/auth/login', { body: { email, password } });
  },
);

When('I fetch GET {string} with that session', async function (this: AuthWorld, path: string) {
  await this.request('GET', path, { useSession: true });
});

Then('the response status is {int}', function (this: AuthWorld, status: number) {
  assert.equal(this.lastStatus, status);
});

Then('the response error code is {string}', function (this: AuthWorld, code: string) {
  assert.equal(this.body<{ error: { code: string } }>().error.code, code);
});

Then('the current user email is {string}', function (this: AuthWorld, email: string) {
  assert.equal(this.body<{ user: { email: string } }>().user.email, lower(email));
});

Then('a session cookie is set', function (this: AuthWorld) {
  assert.ok(this.sessionCookieWasSet(), 'expected a non-empty session cookie');
});

Then('no session cookie is set', function (this: AuthWorld) {
  assert.ok(!this.sessionCookieWasSet(), 'expected no session cookie');
});

// Stronger than "a cookie came back": the cookie is spent on /me and must name the user.
Then(
  'the response creates a signed-in session for {string}',
  async function (this: AuthWorld, email: string) {
    assert.equal(this.lastStatus, 200);
    assert.ok(this.sessionCookieWasSet(), 'expected a non-empty session cookie');
    await this.request('GET', '/me', { useSession: true });
    assert.equal(this.lastStatus, 200);
    assert.equal(this.body<{ user: { email: string } }>().user.email, lower(email));
  },
);

Then('the account for {string} is linked to Google', async function (this: AuthWorld, email: string) {
  const user = await prisma.user.findUnique({ where: { email_lower: lower(email) } });
  assert.ok(user?.google_sub, 'expected google_sub to be set');
});

Then(
  'the account for {string} is not linked to Google',
  async function (this: AuthWorld, email: string) {
    const user = await prisma.user.findUnique({ where: { email_lower: lower(email) } });
    assert.equal(user?.google_sub, null);
  },
);

Then('no user exists for {string}', async function (this: AuthWorld, email: string) {
  assert.equal(await prisma.user.count({ where: { email_lower: lower(email) } }), 0);
});

Then('exactly one user exists for {string}', async function (this: AuthWorld, email: string) {
  assert.equal(await prisma.user.count({ where: { email_lower: lower(email) } }), 1);
});
