/**
 * `interview_flow.feature` @AC-11 — budget exhaustion (I08).
 *
 * The interview is positioned in `hr_round` on question 1 with no technical batch yet, so the
 * answer this scenario submits is one that *would* incur the ADR-I22 tech generation. That is
 * what makes "no AI call is recorded" an assertion about the ceiling rather than about a code
 * path that never called anything.
 */
import assert from 'node:assert/strict';
import { Given, Then, When } from '@cucumber/cucumber';

import { prisma } from '../../src/lib/db';

import { arriveAtQuestion, questionIdAt } from './answers.steps';
import { AiWorld } from './world';

/** `llm_calls` for the interview before the submission — the HR batch already wrote rows. */
let callsBefore = 0;
let submittedQuestionId = '';

Given('I am on the current question of an interview', async function (this: AiWorld) {
  await arriveAtQuestion(this, 1, 4);
  const interview = await prisma.interview.findUniqueOrThrow({ where: { id: this.interviewId } });
  assert.equal(interview.state, 'hr_round');
  assert.equal(await prisma.question.count({ where: { round: { interview_id: interview.id, type: 'tech' } } }), 0);
});

Given(
  'the interview spent_usd equals its budget_usd inside the next AI transaction',
  async function (this: AiWorld) {
    const { budget_usd } = await prisma.interview.findUniqueOrThrow({
      where: { id: this.interviewId },
    });
    const interview = await prisma.interview.update({
      where: { id: this.interviewId },
      data: { spent_usd: budget_usd },
    });
    assert.ok(interview.spent_usd.gte(interview.budget_usd));
    callsBefore = await prisma.llmCall.count({ where: { interview_id: this.interviewId } });
  },
);

When('I submit an answer for the current question', async function (this: AiWorld) {
  const interview = await prisma.interview.findUniqueOrThrow({ where: { id: this.interviewId } });
  submittedQuestionId = await questionIdAt(this, interview.current_index);
  await this.httpPost(`/interviews/${this.interviewId}/answers`, {
    questionId: submittedQuestionId,
    transcript: 'The answer that trips the ceiling.',
    inputMode: 'text',
  });
});

Then('the submitted answer is stored', async function () {
  assert.equal(await prisma.answer.count({ where: { question_id: submittedQuestionId } }), 1);
});

Then('no AI call is recorded for that submission', async function (this: AiWorld) {
  assert.equal(
    await prisma.llmCall.count({ where: { interview_id: this.interviewId } }),
    callsBefore,
  );
});

Then('the interview endedReason is {string}', async function (this: AiWorld, reason: string) {
  const interview = await prisma.interview.findUniqueOrThrow({ where: { id: this.interviewId } });
  assert.equal(interview.ended_reason, reason);
});
