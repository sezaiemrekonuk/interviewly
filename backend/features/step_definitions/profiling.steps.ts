/**
 * `profiling.feature` — the §3.3 two-layer profile snapshot (I04).
 *
 * The scenarios assert on *the compiled user message*, so each action compiles the same
 * prompt the request compiled internally, from the production var mapping and the snapshot
 * the handler actually stored. That is the existing `AiWorld.generateHrRound` pattern
 * (compile alongside, rather than bolt a test-only accessor onto `AiClient`) applied to the
 * HTTP ring.
 *
 * Two scenarios end at report generation, which is I09's endpoint and job. What they assert
 * is I04's though — that the snapshot carries a CV and carries no date of birth into a
 * report prompt — so they call `AiClient.generateReport` with `profileVariables()`, the same
 * production helper I09 will feed it from. No report module is stubbed into existence here.
 */
import assert from 'node:assert/strict';
import { Given, Then, When } from '@cucumber/cucumber';
import type { Prisma } from '@prisma/client';
import { PROMPT_NAMES, reportVars } from '@interviewly/ai';

import { aiClient } from '../../modules/ai';
import { profileVariables } from '../../modules/interview/generation';
import { prisma } from '../../src/lib/db';

import { signIn, setUpInterview } from './interview-generation.steps';
import { AiWorld } from './world';

const DOB = '1990-04-17';
const CV_TEXT = 'Five years of Spring Boot, Postgres and message queues.';

/** A06 owns `PATCH /me/profile`; until it lands the column F02 declared is written directly. */
async function setAccountProfile(world: AiWorld, profile: Prisma.InputJsonObject) {
  await prisma.user.update({ where: { id: world.candidateId }, data: { profile } });
}

// ---------------------------------------------------------------- given

Given('I am signed in as {string}', async function (this: AiWorld, email: string) {
  await signIn.call(this, email.split('@')[0]);
});

Given('my account profile has no cv text', async function (this: AiWorld) {
  this.accountFullName = 'Nadia Ozturk';
  this.accountCvText = '';
  await setAccountProfile(this, { fullName: this.accountFullName, jobTitle: 'Backend Developer' });
});

Given('my account profile has cv text', async function (this: AiWorld) {
  this.accountFullName = 'Cem Yildiz';
  this.accountCvText = CV_TEXT;
  await setAccountProfile(this, { fullName: this.accountFullName, cv_text: CV_TEXT });
});

Given('my account profile has a full name and a date of birth', async function (this: AiWorld) {
  this.accountFullName = 'Deniz Aydin';
  this.accountDob = DOB;
  await setAccountProfile(this, { fullName: this.accountFullName, date_of_birth: DOB });
});

Given('I skip the profiling questions', function (this: AiWorld) {
  this.profileBody = { skip: true };
});

Given('I completed an {int}-question interview', async function (this: AiWorld, count: number) {
  await setUpInterview.call(this, count);
  this.profileBody = { perInterview: { yearsExperience: 5 } };
  await this.httpPost(`/interviews/${this.interviewId}/profile`, this.profileBody);
  assert.equal(this.lastStatus, 200, `profile failed: ${JSON.stringify(this.lastBody)}`);
  // The answer walk to `completed` is I06/I07/I09; this scenario only needs an interview that
  // has finished, so the end state is a fixture rather than a flow.
  await prisma.interview.update({
    where: { id: this.interviewId },
    data: { state: 'completed', ended_reason: 'completed', ended_at: new Date() },
  });
});

// ---------------------------------------------------------------- when

When(
  'I answer the profiling questions with {int} years of experience',
  function (this: AiWorld, years: number) {
    this.profileBody = {
      perInterview: { yearsExperience: years, targetSeniority: 'mid', interests: 'distributed systems' },
    };
  },
);

When('I set up another interview with {int} questions', async function (this: AiWorld, n: number) {
  await setUpInterview.call(this, n);
});

When('the report is generated for that interview', async function (this: AiWorld) {
  const interview = await prisma.interview.findUniqueOrThrow({ where: { id: this.interviewId } });
  const ctx = { interviewId: this.interviewId, traceId: `trace-report-${this.interviewId}` };
  const args = {
    transcript: 'Q: Tell me about a hard bug. A: A deadlock between two writers.',
    language: interview.language,
    ...profileVariables(interview),
    // C03 — the profiling scenarios are about the <candidate_profile> block, not about how
    // the interview ended, so these are the "ran to the end" values. They are still passed:
    // {{endedReason}} has no null marker and the build would fail without them.
    endedReason: 'completed',
    answeredCount: 1,
    plannedCount: interview.target_question_count,
    // C07 — likewise: {{integrity}} has no null marker either, and these scenarios are about a
    // candidate who behaved, so this is the "nothing to report" shape.
    integrity: { flaggedUtterances: [], refusals: 0, forcedAdvances: 0 },
    ctx,
  };

  this.lastStatus = 0;
  this.lastBody = undefined;
  this.generateError = undefined;
  this.built = this.builder().build({
    promptName: PROMPT_NAMES.generateReport,
    vars: reportVars(args),
    ctx,
  });

  try {
    await aiClient().generateReport(args);
  } catch (err) {
    this.generateError = err;
  }
});

// ---------------------------------------------------------------- then

Then(
  'the compiled user message contains the block {string}',
  function (this: AiWorld, block: string) {
    assert.ok(this.userText().includes(block), `compiled user message has no ${block}`);
  },
);

Then(
  'the compiled user message contains no empty {string} block',
  function (this: AiWorld, block: string) {
    assert.ok(!this.userText().includes(block), `compiled user message contains ${block}`);
  },
);

Then(
  'the compiled user message carries the answered profile inside the candidate_profile block',
  function (this: AiWorld) {
    const answered = (this.profileBody.perInterview ?? {}) as Record<string, unknown>;
    assert.ok(Object.keys(answered).length > 0, 'this scenario answered no pre-questions');
    const block = this.blockContent('candidate_profile');
    for (const [key, value] of Object.entries(answered)) {
      assert.ok(block.includes(key), `candidate_profile block is missing "${key}"`);
      assert.ok(block.includes(String(value)), `candidate_profile block is missing "${value}"`);
    }
  },
);

Then('the candidate_profile block content is not {string}', function (this: AiWorld, marker: string) {
  assert.notEqual(this.blockContent('candidate_profile').trim(), marker);
});

Then(
  'the compiled user message carries the account full name inside the candidate_profile block',
  function (this: AiWorld) {
    assert.ok(this.accountFullName, 'this scenario seeded no account full name');
    assert.ok(this.blockContent('candidate_profile').includes(this.accountFullName));
  },
);

Then(
  'the compiled user message carries the cv text inside the candidate_cv block',
  function (this: AiWorld) {
    assert.ok(this.accountCvText, 'this scenario seeded no cv text');
    assert.ok(this.blockContent('candidate_cv').includes(this.accountCvText));
  },
);

/**
 * Both halves matter: the value must be gone, and so must the key that would let a model
 * infer it was withheld for a reason. `dateOfBirth` and `date_of_birth` are both checked
 * because A06 has not fixed the casing of `users.profile` yet.
 */
Then('the compiled user message contains no date of birth', function (this: AiWorld) {
  assert.ok(this.accountDob, 'this scenario seeded no date of birth');
  const text = this.userText();
  assert.ok(!text.includes(this.accountDob), 'the date of birth reached the prompt');
  assert.ok(!text.includes('dateOfBirth'), 'a dateOfBirth key reached the prompt');
  assert.ok(!text.includes('date_of_birth'), 'a date_of_birth key reached the prompt');
});
