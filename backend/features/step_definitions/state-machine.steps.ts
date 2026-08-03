/**
 * `interview_flow.feature` @AC-16 — the K2 transition table (I07).
 *
 * The emission is read off the **Redis channel**, not off the log: that channel is what the
 * SSE stream fans out, so an assertion there proves a room would have seen the event. Reading
 * pino instead would pass with the fan-out unwired.
 *
 * One row of the listed table has no endpoint by design: `hr_round → paused` fires from the
 * technical batch generation ADR-I22 hangs off an HR answer, and there is no route that
 * generates that batch. It is driven at the module level with a failing client, exactly as
 * `question_generation.feature` @AC-1 does, so no test seam reaches production.
 */
import assert from 'node:assert/strict';
import { After, DataTable, Given, Then, When } from '@cucumber/cucumber';
import type { InterviewState } from '@prisma/client';
import { AiError, type AiClient } from '@interviewly/ai';
import type Redis from 'ioredis';

import { aiClient } from '../../modules/ai';
import { redis } from '../../modules/auth/rate-limit';
import { generateRound } from '../../modules/interview/generation';
import { EVENT_CHANNEL_PREFIX, type InterviewStateChanged } from '../../modules/interview/sse';
import { prisma } from '../../src/lib/db';

import { questionIdAt } from './answers.steps';
import { setUpInterview } from './interview-generation.steps';
import { AiWorld } from './world';

/** A transition the scenario drove, and whether its trigger reported success. */
interface Applied {
  from: InterviewState;
  to: InterviewState;
  interviewId: string;
  ok: boolean;
}

interface Rejected {
  status: number;
  code: unknown;
  before: InterviewState;
  after: InterviewState;
}

let applied: Applied[] = [];
let rejected: Rejected[] = [];
let observed: InterviewStateChanged[] = [];
let subscriber: Redis | undefined;

/** Interviews the listed walk parked in a state the unlisted walk needs a subject in. */
const parked = new Map<InterviewState, string>();

After(async function closeSubscriber() {
  await subscriber?.quit();
  subscriber = undefined;
  applied = [];
  rejected = [];
  observed = [];
  parked.clear();
});

/**
 * Redis delivery is not ordered against the HTTP response that triggered it.
 *
 * Waits on the events themselves rather than on a count: the walk drives six *listed* edges
 * but publishes eight, because the second interview it sets up emits its own
 * `created → profiling` and `profiling → hr_round`. A count of six is satisfied before the
 * two edges the scenario is actually about have landed.
 */
async function waitFor(satisfied: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !satisfied(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function stateOf(id: string): Promise<InterviewState> {
  return (await prisma.interview.findUniqueOrThrow({ where: { id } })).state;
}

/** Answers questions `from`..`to` of the current interview, asserting each one lands. */
async function answerThrough(world: AiWorld, from: number, to: number): Promise<void> {
  for (let i = from; i <= to; i++) {
    await world.httpGet(`/interviews/${world.interviewId}/state`);
    await world.httpPost(`/interviews/${world.interviewId}/answers`, {
      questionId: await questionIdAt(world, i),
      transcript: `An answer to question ${i}.`,
      inputMode: 'text',
    });
    assert.equal(world.lastStatus, 200, `answer ${i} failed: ${JSON.stringify(world.lastBody)}`);
  }
}

/** A fresh interview taken to `hr_round`, its HR batch generated. */
async function freshHrRound(world: AiWorld, total: number): Promise<string> {
  await setUpInterview.call(world, total);
  await world.httpPost(`/interviews/${world.interviewId}/profile`, { skip: true });
  assert.equal(world.lastStatus, 200, `profile failed: ${JSON.stringify(world.lastBody)}`);
  return world.interviewId;
}

// ---------------------------------------------------------------- given

Given('the backend state transition table is loaded', async function (this: AiWorld) {
  // Pattern-subscribed before the first transition: the ids the scenario is about do not
  // exist yet, and a subscription opened after the fact would miss the events it is asserting.
  subscriber = redis.duplicate();
  await subscriber.psubscribe(`${EVENT_CHANNEL_PREFIX}*`);
  subscriber.on('pmessage', (_pattern, _channel, payload) => {
    observed.push(JSON.parse(payload) as InterviewStateChanged);
  });
});

// ---------------------------------------------------------------- when

When(
  'each listed HTTP transition is exercised through its endpoint',
  async function (this: AiWorld, table: DataTable) {
    // 5 questions → hr = max(2, round(5 * 0.4)) = 2, technical = 3.
    await setUpInterview.call(this, 5);
    const walked = this.interviewId;
    applied.push({
      from: 'created',
      to: 'profiling',
      interviewId: walked,
      ok: this.lastStatus === 201,
    });

    await this.httpPost(`/interviews/${walked}/profile`, { skip: true });
    applied.push({
      from: 'profiling',
      to: 'hr_round',
      interviewId: walked,
      ok: this.lastStatus === 200,
    });

    await answerThrough(this, 1, 2);
    applied.push({
      from: 'hr_round',
      to: 'tech_round',
      interviewId: walked,
      ok: (await stateOf(walked)) === 'tech_round',
    });

    await answerThrough(this, 3, 5);
    applied.push({
      from: 'tech_round',
      to: 'evaluating',
      interviewId: walked,
      ok: (await stateOf(walked)) === 'evaluating',
    });
    parked.set('evaluating', walked);

    // The one non-HTTP trigger. A client that only ever reports the provider chain exhausted
    // is the failure `generateRound` turns into a pause; everything else it does is real.
    const paused = await freshHrRound(this, 5);
    const unavailable: AiClient = {
      ...aiClient(),
      generateRoundQuestions: async () => {
        throw new AiError('AI_PROVIDER_UNAVAILABLE', 'every provider is exhausted');
      },
    };
    await assert.rejects(
      generateRound(await prisma.interview.findUniqueOrThrow({ where: { id: paused } }), 'tech', {
        traceId: `trace-${paused}`,
        client: unavailable,
      }),
    );
    applied.push({
      from: 'hr_round',
      to: 'paused',
      interviewId: paused,
      ok: (await stateOf(paused)) === 'paused',
    });

    await this.httpPost(`/interviews/${paused}/resume`, {});
    applied.push({
      from: 'paused',
      to: 'hr_round',
      interviewId: paused,
      ok: this.lastStatus === 200,
    });
    parked.set('hr_round', paused);

    // The table is the specification, so it is asserted against rather than read past: a walk
    // that quietly stopped driving an edge would otherwise still report every edge it drove.
    assert.deepEqual(
      applied.map((a) => `${a.from}->${a.to}`),
      table.hashes().map((row) => `${row.from}->${row.to}`),
    );
  },
);

When(
  'each unlisted HTTP transition is exercised through its endpoint',
  async function (this: AiWorld, table: DataTable) {
    for (const row of table.hashes()) {
      const from = row.from as InterviewState;
      // A fresh interview is already in `profiling`; the other two states the table names were
      // parked by the listed walk above.
      let id = parked.get(from);
      if (!id) {
        await setUpInterview.call(this, 5);
        id = this.interviewId;
      }
      assert.equal(await stateOf(id), from, `the subject for ${row.trigger} is not in ${from}`);

      const path = row.trigger.replace(/^POST /, '').replace(':id', id);
      // A state guard that runs after body parsing would answer VALIDATION_ERROR instead, so
      // every body here is well-formed: the state is the only thing wrong with the request.
      const body = path.endsWith('/answers')
        ? { questionId: 'not-reached', transcript: 'not reached', inputMode: 'text' }
        : path.endsWith('/profile')
          ? { skip: true }
          : {};

      const before = await stateOf(id);
      await this.httpPost(path, body);
      rejected.push({
        status: this.lastStatus,
        code: (this.lastBody as { error?: { code?: string } } | undefined)?.error?.code,
        before,
        after: await stateOf(id),
      });
    }
  },
);

// ---------------------------------------------------------------- then

Then('each transition response has a success status', function () {
  for (const a of applied) assert.ok(a.ok, `${a.from} -> ${a.to} did not succeed`);
});

Then(
  'each transition emits {string} with from, to and interviewId',
  async function (this: AiWorld, event: string) {
    assert.equal(event, 'INTERVIEW_STATE_CHANGED');
    const seen = (a: Applied): boolean =>
      observed.some((e) => e.from === a.from && e.to === a.to && e.interviewId === a.interviewId);

    await waitFor(() => applied.every(seen));
    for (const a of applied) {
      assert.ok(seen(a), `no ${event} carrying ${a.from} -> ${a.to} for ${a.interviewId}`);
    }
  },
);

Then('each transition response status is {int}', function (expected: number) {
  assert.ok(rejected.length > 0, 'no rejected transition was exercised');
  for (const r of rejected) assert.equal(r.status, expected);
});

Then('each transition response error code is {string}', function (expected: string) {
  for (const r of rejected) assert.equal(r.code, expected);
});

Then('no rejected transition changes state', function () {
  for (const r of rejected) assert.equal(r.after, r.before);
});
