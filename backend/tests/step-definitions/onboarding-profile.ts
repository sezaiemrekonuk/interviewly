import { strict as assert } from 'node:assert';

import { Then, When } from '@cucumber/cucumber';

import type { AuthWorld } from '../support/world';

const FULL_NAME = 'Ada Lovelace';
const JOB_TITLE = 'Software Engineer';
const DIFFERENT_JOB_TITLE = 'Staff Engineer';

function educationRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    school: `University ${i + 1}`,
    degree: 'BSc',
    field: 'Computer Science',
    graduationYear: 2015 + i,
  }));
}

// Every "the profile carries…" assertion re-fetches rather than trusting `lastBody`: the
// education-cap scenario asserts on the stored profile right after a 422, whose body is
// `{ error: { code } }`, not `{ profile }`.
async function fetchProfile(world: AuthWorld): Promise<Record<string, unknown>> {
  await world.request('GET', '/me/profile', { useSession: true });
  return world.body<{ profile: Record<string, unknown> }>().profile;
}

// -------------------------------------------------------------------------------- When

When('I save onboarding card 1 with a full name and job title', async function (this: AuthWorld) {
  await this.request('PATCH', '/me/profile', {
    useSession: true,
    body: { step: 1, fields: { fullName: FULL_NAME, jobTitle: JOB_TITLE } },
  });
});

When('I save onboarding card 1 with a different job title', async function (this: AuthWorld) {
  await this.request('PATCH', '/me/profile', {
    useSession: true,
    body: { step: 1, fields: { jobTitle: DIFFERENT_JOB_TITLE } },
  });
});

When(
  'I save onboarding card 2 with {int} education rows',
  async function (this: AuthWorld, count: number) {
    await this.request('PATCH', '/me/profile', {
      useSession: true,
      body: { step: 2, fields: { education: educationRows(count) } },
    });
  },
);

When('I complete onboarding without saving any card', async function (this: AuthWorld) {
  await this.request('POST', '/me/profile/complete', { useSession: true });
});

When(
  'I sign out and sign in again as {string}',
  async function (this: AuthWorld, email: string) {
    await this.request('POST', '/auth/logout', { useSession: true });
    const password = this.passwords.get(email.trim().toLowerCase());
    assert.ok(password, `no fixture password recorded for ${email}`);
    await this.request('POST', '/auth/login', { body: { email, password } });
    assert.equal(this.lastStatus, 200, 're-sign-in did not succeed');
  },
);

// -------------------------------------------------------------------------------- Then

Then(
  'the profile carries the card 1 full name and job title',
  async function (this: AuthWorld) {
    const profile = await fetchProfile(this);
    assert.equal(profile.fullName, FULL_NAME);
    assert.equal(profile.jobTitle, JOB_TITLE);
  },
);

Then(
  'the profile carries {int} education rows',
  async function (this: AuthWorld, count: number) {
    const profile = await fetchProfile(this);
    assert.equal((profile.education as unknown[] | undefined)?.length, count);
  },
);

Then(
  'the profile still carries {int} education rows',
  async function (this: AuthWorld, count: number) {
    const profile = await fetchProfile(this);
    assert.equal((profile.education as unknown[] | undefined)?.length, count);
  },
);

Then('the profile carries no education rows', async function (this: AuthWorld) {
  const profile = await fetchProfile(this);
  assert.ok(!profile.education || (profile.education as unknown[]).length === 0);
});

Then('the profile carries no full name', async function (this: AuthWorld) {
  const profile = await fetchProfile(this);
  assert.equal(profile.fullName, undefined);
});

Then('the current user has not completed onboarding', function (this: AuthWorld) {
  assert.equal(
    this.body<{ user: { onboardingCompletedAt: string | null } }>().user.onboardingCompletedAt,
    null,
  );
});

Then('the current user has completed onboarding', function (this: AuthWorld) {
  assert.ok(
    this.body<{ user: { onboardingCompletedAt: string | null } }>().user.onboardingCompletedAt,
  );
});

Then(
  'the response carries the onboarding completion, email verification and interview count',
  function (this: AuthWorld) {
    const user = this.body<{ user: Record<string, unknown> }>().user;
    assert.ok('onboardingCompletedAt' in user);
    assert.ok('emailVerifiedAt' in user);
    assert.equal(typeof user.interviewCount, 'number');
  },
);
