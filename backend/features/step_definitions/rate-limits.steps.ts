/**
 * `rate_limits.feature` @AC-12, @AC-13 — I13.
 *
 * `the fixed clock is {string}` (answers.steps.ts), `the response status is {int}`
 * (ai-provider.steps.ts) and `the response error code is {string}` (interview-setup.steps.ts)
 * are the shared registry's; only what is specific to the limiters lives here.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { After, Given, Then, When } from '@cucumber/cucumber';

import { slidingWindowHit } from '../../modules/auth/rate-limit';
import { clock } from '../../src/lib/clock';
import { prisma } from '../../src/lib/db';

import { AiWorld } from './world';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const PASSWORD = 'correct-horse-battery';

/** Scenario-local, like answers.steps.ts — the suite runs scenarios serially. */
let currentWindowMs = 0;
let signedInEmail = '';

After(function resetScenarioState() {
  currentWindowMs = 0;
  signedInEmail = '';
});

async function startInterview(world: AiWorld): Promise<void> {
  await world.httpPost('/interviews', {
    mode: 'text',
    jobText: 'Backend engineer — remote, full-time. We are hiring a backend developer.',
    targetQuestionCount: 6,
  });
}

// ------------------------------------------------------------------------------- @AC-12

Given(
  'I started {int} interviews during the last 24 hours',
  async function (this: AiWorld, count: number) {
    for (let i = 0; i < count; i += 1) {
      await startInterview(this);
      assert.equal(this.lastStatus, 201, `start ${i + 1}: ${JSON.stringify(this.lastBody)}`);
    }
  },
);

When('I start another interview', async function (this: AiWorld) {
  await startInterview(this);
});

Then('no sixth interview is created', async function (this: AiWorld) {
  const count = await prisma.interview.count({ where: { user_id: this.candidateId } });
  assert.equal(count, 5);
});

When('the fixed clock moves past the rolling 24 hour window', function () {
  const past = new Date(clock.now().getTime() + DAY + 60_000);
  clock.now = () => past;
});

// ------------------------------------------------------------------------------- @AC-13

/**
 * The `<key>` column is real for the two IP-keyed rows (`sign-in`, `register`). Issue 68 landed `app.set('trust proxy', 1)`,
 * so `req.ip` is now the forwarded address — sending `203.0.113.10` here is not a bypass of
 * the limiter under test but the exact header Caddy puts on a request from that client. (The
 * `interview-start` row is still keyed by the signed-in user id, not this string.) `Before` (server.ts) drops
 * `ratelimit:*` per scenario, so each row still gets its own window.
 *
 * Only Caddy can set this in production: `1` is a hop count, so a client that prepends its own
 * X-Forwarded-For still keys off the address Caddy appends. `backend/src/app-trust-proxy.test.ts`
 * is what asserts that.
 */
const asClient = (key: string): Record<string, string> => ({ 'x-forwarded-for': key });

const ACTIONS: Record<
  string,
  {
    windowMs: number;
    /** Puts `count` hits in the window without asserting anything about them. */
    arrange: (world: AiWorld, count: number, key: string) => Promise<void>;
    perform: (world: AiWorld, key: string) => Promise<void>;
  }
> = {
  register: {
    windowMs: HOUR,
    arrange: async (world, count, key) => {
      for (let i = 0; i < count; i += 1) await ACTIONS.register.perform(world, key);
    },
    perform: async (world, key) => {
      await world.httpPost(
        '/auth/register',
        { email: `limit-${randomUUID()}@example.com`, password: PASSWORD, consent: true },
        asClient(key),
      );
    },
  },
  'sign-in': {
    windowMs: 60_000,
    arrange: async (world, count, key) => {
      signedInEmail = `signin-${randomUUID()}@example.com`;
      // The account this row signs in as. Registered from the same client address, which the
      // register budget (3/hour) has room for — this row only spends login's.
      await world.httpPost(
        '/auth/register',
        { email: signedInEmail, password: PASSWORD, consent: true },
        asClient(key),
      );
      assert.equal(world.lastStatus, 201, `register: ${JSON.stringify(world.lastBody)}`);
      for (let i = 0; i < count; i += 1) {
        await ACTIONS['sign-in'].perform(world, key);
        assert.equal(world.lastStatus, 200, `login ${i + 1}: ${JSON.stringify(world.lastBody)}`);
      }
    },
    perform: async (world, key) => {
      await world.httpPost('/auth/login', { email: signedInEmail, password: PASSWORD }, asClient(key));
    },
  },
  // Seeded through the production counter rather than by making 10 real starts: the daily
  // cap is 5, so the 6th real start would 429 with DAILY_INTERVIEW_LIMIT and the hourly
  // limiter this row is about would never be reached. @AC-12 is what proves a real start
  // increments a counter.
  'interview-start': {
    windowMs: HOUR,
    arrange: async (world, count) => {
      for (let i = 0; i < count; i += 1) {
        await slidingWindowHit(`ratelimit:interviewstart:${world.candidateId}`, HOUR);
      }
    },
    perform: startInterview,
  },
};

function action(name: string): (typeof ACTIONS)[string] {
  const spec = ACTIONS[name];
  if (!spec) throw new Error(`no rate-limited action named "${name}"`);
  return spec;
}

Given(
  '{int} successful {string} requests exist for {string} in the current window',
  async function (this: AiWorld, count: number, name: string, key: string) {
    const spec = action(name);
    currentWindowMs = spec.windowMs;
    // Only interview-start needs a session; the other two rows are public endpoints.
    if (name === 'interview-start') {
      const email = `starter-${randomUUID()}@example.com`;
      await this.httpPost('/auth/register', { email, password: PASSWORD, consent: true });
      assert.equal(this.lastStatus, 201, `register: ${JSON.stringify(this.lastBody)}`);
      this.candidateId = (this.lastBody?.user as { id: string }).id;
    }
    await spec.arrange(this, count, key);
  },
);

When(
  'I perform another {string} request for {string}',
  async function (this: AiWorld, name: string, key: string) {
    await action(name).perform(this, key);
  },
);

When('the fixed clock moves past the rate-limit window', function () {
  assert.notEqual(currentWindowMs, 0, 'no rate-limited action was arranged in this scenario');
  const past = new Date(clock.now().getTime() + currentWindowMs + 60_000);
  clock.now = () => past;
});
