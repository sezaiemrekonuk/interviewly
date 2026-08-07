import { strict as assert } from 'node:assert';

import { Then, When } from '@cucumber/cucumber';

import { prisma } from '../../src/lib/db';

import { recordedJobs } from '../support/mail-recorder';
import type { AuthWorld } from '../support/world';

const lower = (email: string) => email.trim().toLowerCase();

// -------------------------------------------------------------------------------- When

// Through the real endpoint the switcher calls, not a `prisma.user.update`: what issue 76 was
// about is that no request path reached this column at all.
When('I switch my language to {string}', async function (this: AuthWorld, locale: string) {
  await this.request('PATCH', '/me/locale', { useSession: true, body: { locale } });
});

When(
  'I switch my language to {string} with no session',
  async function (this: AuthWorld, locale: string) {
    await this.request('PATCH', '/me/locale', { body: { locale } });
  },
);

When(
  'I register with email {string} and password {string} in locale {string}',
  async function (this: AuthWorld, email: string, password: string, locale: string) {
    await this.request('POST', '/auth/register', {
      body: { email, password, consent: true, locale },
    });
  },
);

// -------------------------------------------------------------------------------- Then

Then('the current user locale is {string}', function (this: AuthWorld, locale: string) {
  assert.equal(this.body<{ user: { locale: string } }>().user.locale, locale);
});

// The column, not the response — `publicUser` could echo a value it never persisted, and the
// persisted one is what the mail worker and `interview/setup.ts` read hours later.
Then(
  'the stored locale for {string} is {string}',
  async function (this: AuthWorld, email: string, locale: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { email_lower: lower(email) } });
    assert.equal(user.locale, locale);
  },
);

Then(
  'the queued mail for {string} carries locale {string}',
  function (this: AuthWorld, email: string, locale: string) {
    const jobs = recordedJobs().filter((j) => j.to === lower(email));
    assert.ok(jobs.length > 0, `no mail was queued for ${email}`);
    assert.equal(jobs[jobs.length - 1].locale, locale);
  },
);
