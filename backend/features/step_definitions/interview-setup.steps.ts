/**
 * `question_generation.feature` @AC-6 — POST /interviews and the HR/tech split (I03).
 * AC-7 and @AC-1 in the same file belong to I04 (round generation); their steps are not
 * defined here and stay undefined until that task lands.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Given, Then, When } from '@cucumber/cucumber';

import { prisma } from '../../src/lib/db';

import { AiWorld } from './world';

Given('I am signed in as a candidate', async function (this: AiWorld) {
  const email = `candidate-${randomUUID()}@example.com`;
  await this.httpPost('/auth/register', { email, password: 'correct-horse-battery', consent: true });
  assert.equal(this.lastStatus, 201, `register failed: ${JSON.stringify(this.lastBody)}`);
  this.candidateId = ((this.lastBody?.user as { id: string } | undefined)?.id) ?? '';
});

When(
  'I POST {string} with neither jobText nor uploadId',
  async function (this: AiWorld, path: string) {
    await this.httpPost(path, { mode: 'text', targetQuestionCount: 8 });
  },
);

When(
  'I start an interview with a {string} listing and {int} target questions',
  async function (this: AiWorld, role: string, targetQuestionCount: number) {
    await this.httpPost('/interviews', {
      mode: 'text',
      jobText: `${role} — remote, full-time. We are hiring a ${role.toLowerCase()}.`,
      targetQuestionCount,
    });
    if (this.lastStatus === 201) {
      this.interviewId = (this.lastBody?.interviewId as string | undefined) ?? '';
    }
  },
);

Then('the response error code is {string}', function (this: AiWorld, code: string) {
  const error = this.lastBody?.error as { code?: string } | undefined;
  assert.equal(error?.code, code, `body: ${JSON.stringify(this.lastBody)}`);
});

Then('no interview is created', async function (this: AiWorld) {
  const count = await prisma.interview.count({ where: { user_id: this.candidateId } });
  assert.equal(count, 0);
});

/**
 * The bound has to hold at the table too, not only in the Zod schema — a schema is a property
 * of one handler, and issue #98's ceiling has to survive anything else that learns to insert an
 * interview. `interviews_target_question_count_range` is the CHECK the migration adds.
 */
Then(
  'the database refuses a direct insert of {int} target questions',
  async function (this: AiWorld, count: number) {
    await assert.rejects(
      prisma.interview.create({
        data: {
          user_id: this.candidateId,
          mode: 'text',
          job_text: 'Direct insert probing the check constraint.',
          job_source: 'paste',
          occupation: 'Backend Developer',
          language: 'en',
          target_question_count: count,
          hr_question_count: 2,
        },
      }),
      (err: Error) => /interviews_target_question_count_range/.test(err.message),
    );
  },
);

Then('the interview state is {string}', async function (this: AiWorld, state: string) {
  const interview = await prisma.interview.findUniqueOrThrow({
    where: { id: this.interviewId },
  });
  assert.equal(interview.state, state);
});

Then('the interview has hrQuestionCount {int}', function (this: AiWorld, expected: number) {
  assert.equal(this.lastBody?.hrCount, expected, `body: ${JSON.stringify(this.lastBody)}`);
});

Then('the interview has techQuestionCount {int}', function (this: AiWorld, expected: number) {
  assert.equal(this.lastBody?.techCount, expected, `body: ${JSON.stringify(this.lastBody)}`);
});
