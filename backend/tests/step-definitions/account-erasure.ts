/**
 * Steps for `account_erasure.feature` (issue 009). The consent half asserts what the row
 * carries, not what the request said; the erasure half asserts through the API wherever an
 * API can see it, and drops to the database only for the columns no endpoint will ever
 * return again — which is the whole point of the change.
 */
import { strict as assert } from 'node:assert';

import { hash } from '@node-rs/argon2';
import { Given, Then, When } from '@cucumber/cucumber';

import { CONSENT_VERSION } from '../../modules/auth/consent';
import { prisma, userInterviews } from '../../src/lib/db';

import type { AuthWorld } from '../support/world';

const lower = (email: string) => email.trim().toLowerCase();
const FIXTURE_PASSWORD = '1234567890';

/** The id is captured before erasure: afterwards the email is a tombstone and cannot find it. */
let erasedUserId = '';

When(
  'I register with email {string} and password {string} without accepting the policies',
  async function (this: AuthWorld, email: string, password: string) {
    await this.request('POST', '/auth/register', { body: { email, password } });
  },
);

Then(
  'the account for {string} carries the accepted policy version and a timestamp',
  async function (this: AuthWorld, email: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { email_lower: lower(email) } });
    assert.equal(user.consent_version, CONSENT_VERSION);
    assert.ok(user.consented_at, 'expected consented_at to be stamped');
  },
);

Given(
  'a signed-in account with a profile and an interview exists for {string}',
  async function (this: AuthWorld, email: string) {
    const user = await prisma.user.create({
      data: {
        email_lower: lower(email),
        password_hash: await hash(FIXTURE_PASSWORD),
        // The §3.3 layer-1 shape, including the field the product treats as most sensitive.
        profile: { fullName: 'Deniz Yılmaz', dateOfBirth: '1996-04-02' },
        consent_version: CONSENT_VERSION,
        consented_at: new Date(),
      },
    });
    erasedUserId = user.id;

    const interview = await prisma.interview.create({
      data: {
        user_id: user.id,
        mode: 'text',
        job_text: 'Backend developer',
        job_source: 'paste',
        occupation: 'Backend developer',
        language: 'en',
        target_question_count: 1,
        hr_question_count: 1,
      },
    });
    await prisma.chatMessage.create({
      data: {
        interview_id: interview.id,
        role: 'user',
        content: 'I led the migration off the monolith.',
        trace_id: 'erasure-fixture',
      },
    });
    // ADR-ADD14: a landing captures the vacancy without creating an interview, so this row
    // outlives the interview above and is not reached by soft-deleting it.
    await prisma.jobListing.create({
      data: {
        user_id: user.id,
        external_job_id: 'erasure-fixture-4172834901',
        job_title: 'Backend Developer',
        job_company: 'Fixture Ltd',
        job_text: 'Backend Developer\nFixture Ltd\n\nPostgres, Node, on-call rotation.',
      },
    });

    this.passwords.set(lower(email), FIXTURE_PASSWORD);
    await this.request('POST', '/auth/login', { body: { email, password: FIXTURE_PASSWORD } });
    assert.equal(this.lastStatus, 200, 'fixture sign-in did not succeed');
  },
);

When('I delete my account', async function (this: AuthWorld) {
  await this.request('DELETE', '/me', { useSession: true });
});

Then('the session no longer resolves', async function (this: AuthWorld) {
  await this.request('GET', '/me', { useSession: true });
  assert.equal(this.lastStatus, 401);
});

Then('logging in as {string} is refused', async function (this: AuthWorld, email: string) {
  await this.request('POST', '/auth/login', {
    body: { email, password: this.passwords.get(lower(email)) },
  });
  assert.equal(this.lastStatus, 401);
});

Then('no personal data remains for {string}', async function (this: AuthWorld, email: string) {
  assert.equal(
    await prisma.user.count({ where: { email_lower: lower(email) } }),
    0,
    'the address still resolves to a row',
  );

  const shell = await prisma.user.findUniqueOrThrow({ where: { id: erasedUserId } });
  assert.equal(shell.profile, null, 'users.profile survived the erasure');
  assert.equal(shell.cv_upload_id, null);
  assert.equal(shell.password_hash, null);
  assert.equal(shell.google_sub, null);
  assert.ok(shell.deleted_at, 'expected deleted_at to record the erasure');

  assert.equal(
    await prisma.jobListing.count({ where: { user_id: erasedUserId } }),
    0,
    'a captured job listing survived the erasure',
  );
});

Then('no interview of that account is retrievable', async function () {
  assert.deepEqual(
    await userInterviews(erasedUserId),
    [],
    'a transcript is still reachable through the user-facing helper',
  );
});
