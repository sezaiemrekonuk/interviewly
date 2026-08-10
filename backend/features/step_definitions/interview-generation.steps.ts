/**
 * `question_generation.feature` @AC-7 and @AC-1 — round generation (I04).
 *
 * Two rings, on purpose:
 *
 *  - **@AC-7 is HTTP.** `POST /interviews/:id/profile` is the transition that generates the
 *    HR batch, and the scenario is about what that request does and does not create.
 *  - **@AC-1 is the module.** There is no endpoint that generates the technical batch —
 *    ADR-I22 makes it a trigger the HR round fires, not a route — so the scenario drives
 *    `generateRound` directly and maps its `ApiError` through the same `{ error: { code } }`
 *    envelope `app.ts` would have produced. A shortfall client is passed in as a dependency
 *    rather than swapped into the module singleton, so no test seam reaches production.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { After, Given, Then, When } from '@cucumber/cucumber';
import {
  loadPromptRegistry,
  type AiClient,
  type GenerateRoundQuestionsArgs,
  type QuestionBatch,
} from '@interviewly/ai';

import { redis } from '../../modules/auth/rate-limit';
import { aiClient } from '../../modules/ai';
import { generateRound } from '../../modules/interview/generation';
import { EVENT_CHANNEL_PREFIX, eventNameFor, QUESTIONS_READY } from '../../modules/interview/sse';
import { ApiError, httpStatusFor } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';

import { AiWorld } from './world';

export async function signIn(this: AiWorld, localPart: string): Promise<void> {
  // The feature files name literal addresses, but a scenario has to be re-runnable against a
  // database that kept the previous run's rows, and `users.email_lower` is unique. The local
  // part is kept for readability; uniqueness is the suffix's job.
  const email = `${localPart}-${randomUUID()}@example.com`;
  await this.httpPost('/auth/register', { email, password: 'correct-horse-battery', consent: true });
  assert.equal(this.lastStatus, 201, `register failed: ${JSON.stringify(this.lastBody)}`);
  this.candidateId = (this.lastBody?.user as { id: string } | undefined)?.id ?? '';
}

export async function setUpInterview(this: AiWorld, count: number): Promise<void> {
  if (!this.candidateId) await signIn.call(this, 'candidate');
  await this.httpPost('/interviews', {
    mode: 'text',
    jobText: 'Backend Developer — remote, full-time. We are hiring a backend developer.',
    targetQuestionCount: count,
  });
  assert.equal(this.lastStatus, 201, `setup failed: ${JSON.stringify(this.lastBody)}`);
  this.interviewId = (this.lastBody?.interviewId as string | undefined) ?? '';
  this.profileBody = { skip: true };
}

/** Questions in one round of the current interview, in ask order. */
async function questionsIn(world: AiWorld, type: 'hr' | 'tech') {
  return prisma.question.findMany({
    where: { round: { interview_id: world.interviewId, type } },
    orderBy: { order_index: 'asc' },
  });
}

async function assertOrdered(world: AiWorld, type: 'hr' | 'tech', from: number, to: number) {
  const rows = await questionsIn(world, type);
  assert.deepEqual(
    rows.map((q) => q.order_index),
    Array.from({ length: to - from + 1 }, (_, i) => from + i),
  );
}

// ---------------------------------------------------------------- given

Given('I set up an interview with {int} questions', async function (this: AiWorld, count: number) {
  await setUpInterview.call(this, count);
});

Given('the profiling round is complete', async function (this: AiWorld) {
  await this.httpPost(`/interviews/${this.interviewId}/profile`, this.profileBody);
  assert.equal(this.lastStatus, 200, `profile failed: ${JSON.stringify(this.lastBody)}`);
});

/**
 * The one thing `StubAiClient` cannot be asked for: a batch whose length disagrees with the
 * requested count. That mismatch is the caller's check by design (QuestionBatchSchema does
 * not constrain length), so the fake has to violate it deliberately.
 */
Given(
  'the stub AI is configured to return {int} questions for a requested {int}',
  function (this: AiWorld, returned: number, _requested: number) {
    const real = aiClient();
    this.roundClient = {
      ...real,
      generateRoundQuestions: async (
        args: GenerateRoundQuestionsArgs,
      ): Promise<QuestionBatch> => {
        const full = await real.generateRoundQuestions(args);
        return { questions: full.questions.slice(0, returned) };
      },
    } as AiClient;
  },
);

Given('the stub AI shorts the next batch by one question', function () {
  const client = aiClient();
  const real = client.generateRoundQuestions.bind(client);
  client.generateRoundQuestions = async (args: GenerateRoundQuestionsArgs) => {
    const full = await real(args);
    return { questions: full.questions.slice(0, args.count - 1) };
  };
});

/** Un-rigs both rings: the injected client and the shadowed singleton method. */
function unrig(world: AiWorld): void {
  world.roundClient = undefined;
  delete (aiClient() as unknown as Record<string, unknown>).generateRoundQuestions;
}

/**
 * The state no request creates on purpose: `POST /profile` claims `hr_round` before it
 * generates, so a pause that could not be written or a process that died in between leaves
 * exactly this. Written directly because reproducing it through the API would mean making
 * `applyTransition` fail, and that seam does not exist outside this file's imagination.
 */
Given(
  'the interview is left in {string} with no questions',
  async function (this: AiWorld, state: string) {
    assert.equal(state, 'hr_round', 'only the hr_round strand is modelled here');
    assert.equal((await questionsIn(this, 'hr')).length, 0, 'the interview already has a batch');
    await prisma.interview.update({
      where: { id: this.interviewId },
      data: { state: 'hr_round', current_index: 1 },
    });
  },
);

Given(
  'the stub AI is configured to return a schema-valid batch of {int} questions',
  function (this: AiWorld, _count: number) {
    unrig(this);
  },
);

/**
 * What a room subscribed to `GET /interviews/:id/events` sees, stood up over the same Redis
 * channel the SSE handler subscribes to — the handler itself only reframes these payloads.
 *
 * `hrQuestionCount` is read **at delivery time**, not when the scenario asserts: the bug this
 * covers is a nudge that arrives while the batch is still being generated, and a count taken
 * after the request finished reports the same number for both the too-early event and the
 * useful one.
 */
interface ObservedNudge {
  name: string;
  interviewId: string;
  hrQuestionCount: Promise<number>;
}

let nudgeSubscriber: ReturnType<typeof redis.duplicate> | undefined;
const nudges: ObservedNudge[] = [];

Given('the room is listening on the interview event stream', async function (this: AiWorld) {
  nudgeSubscriber = redis.duplicate();
  await nudgeSubscriber.psubscribe(`${EVENT_CHANNEL_PREFIX}*`);
  nudgeSubscriber.on('pmessage', (_pattern, _channel, payload) => {
    const parsed = JSON.parse(payload) as { interviewId: string };
    nudges.push({
      name: eventNameFor(payload),
      interviewId: parsed.interviewId,
      // Swallowed rather than awaited here: a rejection on a listener callback has no caller
      // to reach, and the assertion below reads a failed count as "no questions".
      hrQuestionCount: prisma.question
        .count({ where: { round: { interview_id: parsed.interviewId, type: 'hr' } } })
        .catch(() => 0),
    });
  });
});

/** Redis delivery is not ordered against the HTTP response that triggered the publish. */
async function waitForNudge(satisfied: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !satisfied(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

After(async function (this: AiWorld) {
  unrig(this);
  nudges.length = 0;
  const subscriber = nudgeSubscriber;
  nudgeSubscriber = undefined;
  await subscriber?.quit();
});

// ---------------------------------------------------------------- when

When(
  'I POST {string} for an interview that is not in {string}',
  async function (this: AiWorld, _path: string, state: string) {
    // `state` is the state the interview must NOT be in — the only one the transition is
    // legal from. Park it one state further on, which is where a candidate who already
    // answered the profiling form would be.
    assert.equal(state, 'profiling', 'only the profiling guard is modelled here');
    await prisma.interview.update({
      where: { id: this.interviewId },
      data: { state: 'hr_round' },
    });
    await this.httpPost(`/interviews/${this.interviewId}/profile`, this.profileBody);
  },
);

When('I POST {string} for the profiling interview', async function (this: AiWorld, _path: string) {
  await prisma.interview.update({
    where: { id: this.interviewId },
    data: { state: 'profiling' },
  });
  await this.httpPost(`/interviews/${this.interviewId}/profile`, this.profileBody);
});

When('I POST {string} for the paused interview', async function (this: AiWorld, _path: string) {
  await this.httpPost(`/interviews/${this.interviewId}/resume`, {});
});

When('I POST {string} for that interview', async function (this: AiWorld, path: string) {
  await this.httpPost(path.replace(':id', this.interviewId), {});
});

When(
  'the {word} round of {int} questions is generated',
  async function (this: AiWorld, round: string, count: number) {
    const roundType = round === 'technical' ? 'tech' : 'hr';
    const interview = await prisma.interview.findUniqueOrThrow({
      where: { id: this.interviewId },
    });
    assert.equal(
      interview.target_question_count - interview.hr_question_count,
      count,
      'the scenario and the interview disagree on the technical count',
    );

    // Reset the response fixtures so `the response status is 200` reads this action, not the
    // POST that set the interview up.
    this.lastStatus = 0;
    this.lastBody = undefined;
    this.generateError = undefined;

    try {
      await generateRound(interview, roundType, {
        traceId: `trace-${this.interviewId}`,
        client: this.roundClient,
      });
    } catch (err) {
      this.generateError = err;
      if (!(err instanceof ApiError)) throw err;
      // The envelope app.ts's error handler would have produced for the same throw.
      this.lastStatus = httpStatusFor(err.code);
      this.lastBody = { error: { code: err.code } };
    }
  },
);

// ---------------------------------------------------------------- then

Then('no HR questions exist for that interview', async function (this: AiWorld) {
  assert.equal((await questionsIn(this, 'hr')).length, 0);
});

/**
 * The acceptance criterion issue #54 turns on: *an* event is not enough, the room needs one
 * that arrives when there is something to refetch. Asserting the batch existed at delivery is
 * what a publish moved back in front of the insert would fail.
 */
Then('the room is nudged once the HR questions exist', async function (this: AiWorld) {
  const mine = (): ObservedNudge[] => nudges.filter((n) => n.interviewId === this.interviewId);
  await waitForNudge(() => mine().some((n) => n.name === QUESTIONS_READY));

  const ready = mine().filter((n) => n.name === QUESTIONS_READY);
  assert.equal(ready.length, 1, `expected one ${QUESTIONS_READY}, saw ${ready.length}`);
  assert.ok(
    (await ready[0].hrQuestionCount) > 0,
    `${QUESTIONS_READY} was delivered before the HR batch existed`,
  );
  // The transition's nudge is the one that lands too early, so the useful event has to be the
  // last thing the room hears — otherwise it refetches back into the waiting panel.
  assert.equal(mine().at(-1)?.name, QUESTIONS_READY, 'a later nudge followed the questions');
});

// `exactly {int} questions exist for the HR round` is defined in ai-provider.steps.ts, which
// owned it first; it branches on `interviewId` to serve this file's HTTP ring too.

Then(
  'exactly {int} questions exist for the technical round',
  async function (this: AiWorld, n: number) {
    assert.equal((await questionsIn(this, 'tech')).length, n);
  },
);

Then('the HR questions are ordered {int} to {int}', async function (this: AiWorld, a, b) {
  await assertOrdered(this, 'hr', a, b);
});

Then('the technical questions are ordered {int} to {int}', async function (this: AiWorld, a, b) {
  await assertOrdered(this, 'tech', a, b);
});

Then('the technical round has no questions yet', async function (this: AiWorld) {
  assert.equal((await questionsIn(this, 'tech')).length, 0);
});

Then('no questions exist for the technical round', async function (this: AiWorld) {
  assert.equal((await questionsIn(this, 'tech')).length, 0);
});

Then('no questions are handed back to the interview', function (this: AiWorld) {
  assert.ok(this.generateError, 'generation returned a batch where it should have rejected it');
});

Then(
  'each generated question has a kind in {string}',
  async function (this: AiWorld, allowed: string) {
    const kinds = allowed.split(',').map((k) => k.trim());
    for (const q of await questionsIn(this, 'tech')) assert.ok(kinds.includes(q.kind));
  },
);

Then(
  'each generated question has a difficulty in {string}',
  async function (this: AiWorld, allowed: string) {
    const levels = allowed.split(',').map((d) => d.trim());
    for (const q of await questionsIn(this, 'tech')) assert.ok(levels.includes(q.difficulty));
  },
);

/**
 * Read from `llm_calls`, not from anything the test compiled: the point is that the call the
 * app actually made is auditable under a stable prompt identity. `prompt_uuid` is the stored
 * identity (ADR-I17); the registry maps it back to the name the scenario names.
 *
 * Searches every row of the scenario rather than the newest one. It used to read
 * `findFirst(orderBy: created_at desc)` — "the last call" and "the call this scenario is
 * about" were the same row while `POST /profile` made exactly one AI call. ADR-C02 gave the
 * request a second one: `openRound` compiles `interview.conduct.turn` after the question
 * batch so the interviewer greets the candidate, and it is now the newest row. Pinning the
 * assertion to the newest row would make this step assert whichever call happens to be last,
 * which is not what its English says; presence under the named identity is.
 */
Then('the recorded AI prompt name is {string}', async function (this: AiWorld, name: string) {
  const calls = await prisma.llmCall.findMany({ where: { interview_id: this.interviewId } });
  assert.ok(calls.length, `no llm_calls row was recorded for interview ${this.interviewId}`);
  const uuid = loadPromptRegistry().resolve(name).uuid;
  assert.ok(
    calls.some((c) => c.prompt_uuid === uuid),
    `no llm_calls row for ${name} (${uuid}); recorded: ${calls.map((c) => c.prompt_uuid).join(', ')}`,
  );
});
