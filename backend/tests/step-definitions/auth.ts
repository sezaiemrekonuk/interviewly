import { strict as assert } from 'node:assert';

import { hash } from '@node-rs/argon2';
import { Given, Then, When } from '@cucumber/cucumber';

import { prisma } from '../../src/lib/db';

import type { AuthWorld } from '../support/world';

const lower = (email: string) => email.trim().toLowerCase();

Given('a password account exists for {string}', async function (this: AuthWorld, email: string) {
  await prisma.user.create({
    data: { email_lower: lower(email), password_hash: await hash('Password123!') },
  });
});

Given(
  'a password account exists for {string} with password {string}',
  async function (this: AuthWorld, email: string, password: string) {
    await prisma.user.create({
      data: { email_lower: lower(email), password_hash: await hash(password) },
    });
  },
);

When(
  'I register with email {string} and password {string}',
  async function (this: AuthWorld, email: string, password: string) {
    await this.request('POST', '/auth/register', { body: { email, password } });
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

Then('no user exists for {string}', async function (this: AuthWorld, email: string) {
  assert.equal(await prisma.user.count({ where: { email_lower: lower(email) } }), 0);
});

Then('exactly one user exists for {string}', async function (this: AuthWorld, email: string) {
  assert.equal(await prisma.user.count({ where: { email_lower: lower(email) } }), 1);
});
