/**
 * `interview_flow.feature` @AC-8, @AC-9, @AC-10 — answer submission (I06).
 *
 * Everything drives the real app over HTTP. Positioning at question k is done by *answering*
 * questions 1..k-1 through the endpoint rather than writing `current_index` directly: the
 * fixture then exercises the same advance the assertion is about, so a broken advance cannot
 * be hidden by a helpful test setup.
 */
import assert from 'node:assert/strict';
import { After, Given, Then, When } from '@cucumber/cucumber';

import { clock } from '../../src/lib/clock';
import { prisma } from '../../src/lib/db';

import { setUpInterview } from './interview-generation.steps';
import { AiWorld } from './world';

const realNow = clock.now;

/** The question the last `When` submitted — "the stored answer" refers to this one. */
let lastAnsweredQuestionId = '';

// Scenario-local, not on the World: cucumber runs scenarios serially here, and this hook is
// what makes that safe. Move both onto AiWorld the day the suite runs in parallel.
After(function resetScenarioState() {
  clock.now = realNow;
  lastAnsweredQuestionId = '';
});

/** The question row a *global* `current_index` points at — the walk `state.ts` does. */
export async function questionIdAt(world: AiWorld, index: number): Promise<string> {
  const interview = await prisma.interview.findUniqueOrThrow({ where: { id: world.interviewId } });
  const type = index <= interview.hr_question_count ? 'hr' : 'tech';
  const question = await prisma.question.findFirstOrThrow({
    where: {
      round: { interview_id: interview.id, type },
      order_index: type === 'hr' ? index : index - interview.hr_question_count,
    },
  });
  return question.id;
}

async function submitAnswerFor(
  world: AiWorld,
  index: number,
  body: Record<string, unknown> = {},
): Promise<void> {
  lastAnsweredQuestionId = await questionIdAt(world, index);
  await world.httpPost(`/interviews/${world.interviewId}/answers`, {
    questionId: lastAnsweredQuestionId,
    transcript: `An answer to question ${index}.`,
    inputMode: 'text',
    ...body,
  });
}

/**
 * A fresh interview parked on question `index`, HR batch generated.
 *
 * The `GET /state` before each answer is not decoration: it is what delivers the question and
 * stamps `asked_at`, exactly as a room does, so `duration_ms` has a baseline.
 */
async function arriveAtQuestion(world: AiWorld, index: number, total: number): Promise<void> {
  await setUpInterview.call(world, total);
  await world.httpPost(`/interviews/${world.interviewId}/profile`, { skip: true });
  assert.equal(world.lastStatus, 200, `profile failed: ${JSON.stringify(world.lastBody)}`);

  for (let i = 1; i < index; i++) {
    await world.httpGet(`/interviews/${world.interviewId}/state`);
    await submitAnswerFor(world, i);
    assert.equal(world.lastStatus, 200, `answer ${i} failed: ${JSON.stringify(world.lastBody)}`);
  }
  await world.httpGet(`/interviews/${world.interviewId}/state`);
}

// ---------------------------------------------------------------- given

Given(
  'I am on question {int} of an {int}-question interview',
  async function (this: AiWorld, index: number, total: number) {
    await arriveAtQuestion(this, index, total);
    const interview = await prisma.interview.findUniqueOrThrow({ where: { id: this.interviewId } });
    assert.equal(interview.current_index, index);
  },
);

Given(
  'I answered {int} questions in an {int}-question interview',
  async function (this: AiWorld, answered: number, total: number) {
    await arriveAtQuestion(this, answered + 1, total);
  },
);

Given('the fixed clock is {string}', function (this: AiWorld, instant: string) {
  const fixed = new Date(instant);
  clock.now = () => fixed;
});

/**
 * Sets up the interview *and* backdates the delivery. `asked_at` is normally stamped by the
 * `GET /state` in `arriveAtQuestion`, at the fixed clock; overwriting it here is the only way
 * to put a known interval between delivery and answer without sleeping for twelve seconds.
 */
Given(
  'question {int} was delivered at {string}',
  async function (this: AiWorld, index: number, instant: string) {
    await arriveAtQuestion(this, index, 8);
    await prisma.question.update({
      where: { id: await questionIdAt(this, index) },
      data: { asked_at: new Date(instant) },
    });
  },
);

// ---------------------------------------------------------------- when

When('I submit an answer for question {int}', async function (this: AiWorld, index: number) {
  await submitAnswerFor(this, index);
});

When(
  'I submit an answer for question {int} with client duration_ms {int}',
  async function (this: AiWorld, index: number, duration: number) {
    await submitAnswerFor(this, index, { duration_ms: duration });
  },
);

When('I fetch GET {string}', async function (this: AiWorld, path: string) {
  await this.httpGet(path.replace(':id', this.interviewId));
});

/**
 * "New client connection" means no client memory, not a new identity: the session cookie is
 * what a refreshed tab still has. The response fixtures are cleared first so the assertions
 * that follow cannot be satisfied by the previous fetch's body.
 */
When(
  'I fetch GET {string} with a new client connection',
  async function (this: AiWorld, path: string) {
    this.lastStatus = 0;
    this.lastBody = undefined;
    await this.httpGet(path.replace(':id', this.interviewId));
  },
);

// ---------------------------------------------------------------- then

Then('the interview currentIndex is {int}', async function (this: AiWorld, expected: number) {
  const interview = await prisma.interview.findUniqueOrThrow({ where: { id: this.interviewId } });
  assert.equal(interview.current_index, expected);
});

Then('currentIndex is {int}', function (this: AiWorld, expected: number) {
  assert.equal(this.lastBody?.currentIndex, expected, `body: ${JSON.stringify(this.lastBody)}`);
});

Then(
  'the transcript cursor covers {int} answers',
  async function (this: AiWorld, expected: number) {
    assert.equal(
      this.lastBody?.transcriptCursor,
      expected,
      `body: ${JSON.stringify(this.lastBody)}`,
    );
    // The cursor is only worth anything if it agrees with what was actually stored.
    const stored = await prisma.answer.count({
      where: { question: { round: { interview_id: this.interviewId } } },
    });
    assert.equal(stored, expected);
  },
);

// By question id, not by "most recent": under a fixed clock every answer in the scenario
// shares one `answered_at`, so an ordered read would pick an arbitrary row.
Then('the stored answer duration_ms is {int}', async function (this: AiWorld, expected: number) {
  const answer = await prisma.answer.findFirstOrThrow({
    where: { question_id: lastAnsweredQuestionId },
  });
  assert.equal(answer.duration_ms, expected);
});

Then('no audio session is required', async function (this: AiWorld) {
  const interview = await prisma.interview.findUniqueOrThrow({ where: { id: this.interviewId } });
  assert.equal(interview.mode, 'text');
  assert.equal(await prisma.voiceSession.count({ where: { interview_id: interview.id } }), 0);
});
