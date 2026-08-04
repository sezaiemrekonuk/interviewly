/**
 * `voice_webhook.feature` @AC-3, @AC-4, @AC-5, @AC-10 — the four gates (V02).
 *
 * Webhooks are posted with `fetch` directly rather than through `AiWorld.httpPost`: they carry
 * no cookie and no `Origin` (server-to-server), and the HMAC must cover the exact bytes sent,
 * so the body string is built once here and both signed and transmitted.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';

import { webhookSeam } from '../../modules/voice/webhook-auth';
import { clock } from '../../src/lib/clock';
import { config } from '../../src/lib/env';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

import { questionIdAt } from './answers.steps';
import { signIn } from './interview-generation.steps';
import { serverState } from './server';
import { AiWorld } from './world';

// target 8 → hr 3 (setup.ts split). @AC-5 needs a round that is NOT exhausted at index 3, so
// the HR round must hold at least three questions; target 4 (hr 2) would make its premature
// `end_round` a legal handover and the 409 assertion vacuous.
const TOTAL_QUESTIONS = 8;
const TEST_SECRET = 'acceptance-webhook-secret';

const realNow = clock.now;
const realSecret = webhookSeam.secret;
const realInfo = logger.info;
const realWarn = logger.warn;

/** The live session's nonce and the answer-row count taken just before the last webhook. */
let nonce = '';
let answersBefore = 0;

Before({ tags: '@voice-webhook' }, function (this: AiWorld) {
  webhookSeam.secret = TEST_SECRET;
  nonce = '';
  answersBefore = 0;
  this.resetEvents();
  // Both levels: `VOICE_WEBHOOK_RECEIVED` is info, every gate rejection is warn. @AC-10 asserts
  // over the union, so capturing one level would let a secret leak through the other.
  captureLogs(this);
});

/** Mirrors report-run.steps.ts's `captureWarnings`, widened to both levels. */
function captureLogs(world: AiWorld): void {
  logger.info = function capturedInfo(obj: unknown, msg?: string) {
    if (typeof msg === 'string') {
      world.events.push({ level: 'info', event: msg, fields: obj as Record<string, unknown> });
    }
    return realInfo.call(logger, obj as object, msg);
  } as typeof logger.info;
  logger.warn = function capturedWarn(obj: unknown, msg?: string) {
    if (typeof msg === 'string') {
      world.events.push({ level: 'warn', event: msg, fields: obj as Record<string, unknown> });
    }
    return realWarn.call(logger, obj as object, msg);
  } as typeof logger.warn;
}

After({ tags: '@voice-webhook' }, function () {
  webhookSeam.secret = realSecret;
  clock.now = realNow;
  logger.info = realInfo;
  logger.warn = realWarn;
});

// ---------------------------------------------------------------- helpers

/** A voice-mode interview parked on question `index`, HR batch generated, questions delivered. */
async function arriveAtVoiceQuestion(world: AiWorld, index: number): Promise<void> {
  if (!world.candidateId) await signIn.call(world, 'candidate');
  await world.httpPost('/interviews', {
    mode: 'voice',
    jobText: 'Voice interview position — backend developer, remote.',
    targetQuestionCount: TOTAL_QUESTIONS,
  });
  assert.equal(world.lastStatus, 201, `setup failed: ${JSON.stringify(world.lastBody)}`);
  world.interviewId = (world.lastBody?.interviewId as string | undefined) ?? '';

  await world.httpPost(`/interviews/${world.interviewId}/profile`, { skip: true });
  assert.equal(world.lastStatus, 200, `profile failed: ${JSON.stringify(world.lastBody)}`);

  await advanceToQuestion(world, index);
}

/** Answer questions up to `index - 1` over HTTP, then deliver `index` (stamps `asked_at`). */
async function advanceToQuestion(world: AiWorld, index: number): Promise<void> {
  const interview = await prisma.interview.findUniqueOrThrow({ where: { id: world.interviewId } });
  for (let i = interview.current_index; i < index; i++) {
    await world.httpGet(`/interviews/${world.interviewId}/state`);
    await world.httpPost(`/interviews/${world.interviewId}/answers`, {
      questionId: await questionIdAt(world, i),
      transcript: `A text answer to question ${i}.`,
      inputMode: 'text',
    });
    assert.equal(world.lastStatus, 200, `answer ${i} failed: ${JSON.stringify(world.lastBody)}`);
  }
  await world.httpGet(`/interviews/${world.interviewId}/state`);
}

async function mintSession(world: AiWorld): Promise<void> {
  await world.httpPost(`/interviews/${world.interviewId}/voice/session`, {});
  assert.equal(world.lastStatus, 201, `mint failed: ${JSON.stringify(world.lastBody)}`);
  const vars = world.lastBody?.dynamicVars as { nonce: string } | undefined;
  nonce = vars?.nonce ?? '';
  assert.ok(nonce, 'mint returned no nonce');
}

interface WebhookDefect {
  secret?: string;
  timestampOffsetSeconds?: number;
  nonce?: string;
}

async function postWebhook(
  world: AiWorld,
  action: string,
  body: Record<string, unknown>,
  defect: WebhookDefect = {},
): Promise<void> {
  answersBefore = await answerCount(world);

  const raw = JSON.stringify({ interviewId: world.interviewId, nonce, ...body });
  const secret = defect.secret ?? TEST_SECRET;
  const timestamp = Math.floor(clock.now().getTime() / 1000) + (defect.timestampOffsetSeconds ?? 0);
  const signature = createHmac('sha256', secret).update(raw).digest('hex');

  const res = await fetch(`${serverState.baseUrl}/webhooks/elevenlabs/${action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-elevenlabs-signature': `sha256=${signature}`,
      'x-elevenlabs-timestamp': String(timestamp),
    },
    body: raw,
  });
  world.lastStatus = res.status;
  world.lastBody = await res.json().catch(() => undefined);
}

async function answerCount(world: AiWorld): Promise<number> {
  return prisma.answer.count({
    where: { question: { round: { interview_id: world.interviewId } } },
  });
}

async function currentIndex(world: AiWorld): Promise<number> {
  const row = await prisma.interview.findUniqueOrThrow({ where: { id: world.interviewId } });
  return row.current_index;
}

function fixClock(iso: string): void {
  const fixed = new Date(iso);
  clock.now = () => fixed;
}

/** Every captured field of every captured event, flattened to searchable strings. */
function allCapturedValues(world: AiWorld): string[] {
  return world.events.flatMap((e) => [e.event, ...Object.values(e.fields).map((v) => String(v))]);
}

// ---------------------------------------------------------------- given

Given('a live voice session exists for my interview', async function (this: AiWorld) {
  await arriveAtVoiceQuestion(this, 1);
  await mintSession(this);
});

Given(
  'a live voice session exists for my interview with expires_at {string}',
  async function (this: AiWorld, iso: string) {
    await arriveAtVoiceQuestion(this, 1);
    await mintSession(this);
    // The mint computes its own ceiling from the round clock; the scenario names an exact one.
    await prisma.voiceSession.updateMany({
      where: { interview_id: this.interviewId, nonce },
      data: { expires_at: new Date(iso) },
    });
  },
);

// `the fixed clock is {string}` is answers.steps.ts:98 — same seam, same effect.

Given('the interview is on question {int}', async function (this: AiWorld, index: number) {
  await advanceToQuestion(this, index);
  assert.equal(await currentIndex(this), index);
});

// ---------------------------------------------------------------- when

When('the fixed clock moves to {string}', function (iso: string) {
  fixClock(iso);
});

When(
  'ElevenLabs posts a {string} webhook that is signed with the wrong secret',
  async function (this: AiWorld, action: string) {
    await postWebhook(this, action, { transcript: 'A spoken answer.' }, { secret: 'not-the-secret' });
  },
);

When(
  'ElevenLabs posts a {string} webhook that is carrying a timestamp outside the freshness window',
  async function (this: AiWorld, action: string) {
    await postWebhook(
      this,
      action,
      { transcript: 'A spoken answer.' },
      { timestampOffsetSeconds: -(config.VOICE_WEBHOOK_FRESHNESS_SECONDS + 60) },
    );
  },
);

When(
  'ElevenLabs posts a correctly signed and fresh {string} webhook with the live nonce',
  async function (this: AiWorld, action: string) {
    await postWebhook(this, action, { transcript: 'A spoken answer.' });
  },
);

When(
  // `\(` — an unescaped paren is a cucumber-expression optional group, not a literal.
  'ElevenLabs posts a correctly signed {string} webhook whose \\(interviewId, nonce) matches no unexpired row',
  async function (this: AiWorld, action: string) {
    const live = nonce;
    nonce = 'a'.repeat(64); // correctly shaped, never minted
    await postWebhook(this, action, { transcript: 'A spoken answer.' });
    nonce = live;
  },
);

When(
  'ElevenLabs posts a correctly signed {string} webhook with the live nonce',
  async function (this: AiWorld, action: string) {
    await postWebhook(this, action, { transcript: 'A spoken answer.' });
  },
);

When(
  'ElevenLabs posts a valid {string} webhook with the live nonce at {string}',
  async function (this: AiWorld, action: string, iso: string) {
    fixClock(iso);
    await postWebhook(this, action, { transcript: 'A spoken answer.' });
  },
);

When(
  'ElevenLabs posts a valid {string} webhook with the live nonce',
  async function (this: AiWorld, action: string) {
    await postWebhook(this, action, { transcript: 'A spoken answer.' });
  },
);

When(
  'ElevenLabs posts a valid {string} webhook before the round\'s questions are exhausted',
  async function (this: AiWorld, action: string) {
    await postWebhook(this, action, {});
  },
);

When(
  'ElevenLabs posts a valid {string} webhook whose transcript is {string}',
  async function (this: AiWorld, action: string, transcript: string) {
    await postWebhook(this, action, { transcript });
  },
);

When(
  'a {string} webhook signed with the wrong secret is rejected',
  async function (this: AiWorld, action: string) {
    await postWebhook(this, action, { transcript: 'A spoken answer.' }, { secret: 'not-the-secret' });
    assert.equal(this.lastStatus, 401, 'expected the wrong-secret webhook to be rejected');
  },
);

// ---------------------------------------------------------------- then

// One global step registry (ADR-I21): `the response status is {int}` (ai-provider.steps),
// `the response error code is {string}` + `the interview state is {string}`
// (interview-setup.steps), `the interview currentIndex is {int}` (answers.steps) and
// `the interview endedReason is {string}` (budget.steps) are already defined over AiWorld
// and assert exactly what this feature means. Redefining any of them is an ambiguous-step
// failure across the whole suite.

Then('the interview is still on question {int}', async function (this: AiWorld, index: number) {
  assert.equal(await currentIndex(this), index);
});

Then('no answer row is written', async function (this: AiWorld) {
  assert.equal(
    await answerCount(this),
    answersBefore,
    'the rejected webhook wrote an answer row',
  );
});

Then(
  'a {string} event is emitted with the interviewId',
  function (this: AiWorld, event: string) {
    const captured = this.eventsNamed(event);
    assert.ok(captured.length > 0, `no ${event} event captured`);
    assert.ok(
      captured.some((e) => e.fields.interviewId === this.interviewId),
      `${event} carried no interviewId: ${JSON.stringify(captured)}`,
    );
  },
);

Then('the interview endedReason is not set', async function (this: AiWorld) {
  const row = await prisma.interview.findUniqueOrThrow({ where: { id: this.interviewId } });
  assert.equal(row.ended_reason, null);
});

Then(
  'an answers row for question {int} is stored with input_mode {string}',
  async function (this: AiWorld, index: number, mode: string) {
    const answer = await prisma.answer.findFirst({
      where: { question_id: await questionIdAt(this, index) },
    });
    assert.ok(answer, `no answer row for question ${index}`);
    assert.equal(answer.input_mode, mode);
  },
);

Then(
  'the captured {string} event includes the interviewId and the action',
  function (this: AiWorld, event: string) {
    const captured = this.eventsNamed(event);
    assert.ok(captured.length > 0, `no ${event} event captured`);
    assert.ok(
      captured.some((e) => e.fields.interviewId === this.interviewId && !!e.fields.action),
      `${event} missing interviewId/action: ${JSON.stringify(captured)}`,
    );
  },
);

Then('the captured {string} event includes the interviewId', function (this: AiWorld, event: string) {
  const captured = this.eventsNamed(event);
  assert.ok(captured.length > 0, `no ${event} event captured`);
  assert.ok(captured.some((e) => e.fields.interviewId === this.interviewId));
});

Then('no captured log field contains the nonce', function (this: AiWorld) {
  assert.ok(nonce, 'no nonce to check against');
  const hit = allCapturedValues(this).find((v) => v.includes(nonce));
  assert.equal(hit, undefined, `a log field leaked the nonce: ${hit}`);
});

Then('no captured log field contains the session token', function (this: AiWorld) {
  const token = (this.lastBody as { token?: string } | undefined)?.token ?? `fake-token-${this.interviewId}`;
  const hit = allCapturedValues(this).find((v) => v.includes(token));
  assert.equal(hit, undefined, `a log field leaked the session token: ${hit}`);
});

Then('no captured log field contains the ElevenLabs API key', function (this: AiWorld) {
  const values = allCapturedValues(this);
  const key = config.ELEVENLABS_API_KEY;
  if (key) assert.ok(!values.some((v) => v.includes(key)), 'a log field leaked the API key');
  assert.ok(
    !values.some((v) => v.includes('ELEVENLABS_API_KEY') || v.includes(TEST_SECRET)),
    'a log field leaked a webhook credential',
  );
});

Then(
  'no captured log field contains the transcript text {string}',
  function (this: AiWorld, transcript: string) {
    const hit = allCapturedValues(this).find((v) => v.includes(transcript));
    assert.equal(hit, undefined, `a log field leaked the transcript: ${hit}`);
  },
);
