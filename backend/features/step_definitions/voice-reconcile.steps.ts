/**
 * `voice_reconciliation.feature` @AC-7 — the post-call cost invariant (V04).
 *
 * The chain is driven for real: a signed `post_call` webhook enqueues on the `voice.reconcile`
 * BullMQ queue, and a `Worker` built here dequeues it and calls `reconcileVoiceUsage` — the
 * same function `worker/src/jobs/voice-reconcile.ts` calls. The processor is mirrored rather
 * than imported for the reason `report-job.steps.ts` gives: cucumber runs against backend
 * source via tsx and never builds `worker/`'s dist. The mirror is one line; the transaction
 * under test is the real one.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { Worker } from 'bullmq';
import { loadModelPrices } from '@interviewly/ai';

import { reconcileVoiceUsage } from '../../modules/voice/reconcile';
import type { VoiceReconcileJob } from '../../modules/voice/reconcile-webhook';
import { webhookSeam } from '../../modules/voice/webhook-auth';
import { clock } from '../../src/lib/clock';
import { prisma } from '../../src/lib/db';
import { config } from '../../src/lib/env';
import { logger } from '../../src/lib/logger';
import { VOICE_RECONCILE_QUEUE } from '../../src/lib/queue';

import { signIn } from './interview-generation.steps';
import { serverState } from './server';
import { AiWorld } from './world';

const TEST_SECRET = 'acceptance-reconcile-secret';
const connection = { url: config.REDIS_URL };

const realSecret = webhookSeam.secret;
const realInfo = logger.info;
const realWarn = logger.warn;

/** Scenario-local, same convention as voice-webhook.steps.ts. */
let spentBefore = '';
let callsBefore = 0;
let processed = 0;

Before({ tags: '@voice-reconciliation' }, function (this: AiWorld) {
  webhookSeam.secret = TEST_SECRET;
  spentBefore = '';
  callsBefore = 0;
  processed = 0;
  this.resetEvents();
  // Both levels, same reason as voice-webhook.steps.ts: VOICE_USAGE_RECONCILED is info and
  // PRICE_MISSING is warn.
  captureLogs(this);
});

/** Third copy of this helper — the STATE.md backlog entry to extract it now has its trigger. */
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

After({ tags: '@voice-reconciliation' }, function () {
  webhookSeam.secret = realSecret;
  logger.info = realInfo;
  logger.warn = realWarn;
});

// ---------------------------------------------------------------- helpers

/** The reconciled cost of `seconds`, read from model-prices.yaml so the two cannot drift. */
function expectedCostUsd(seconds: number): number {
  const price = loadModelPrices().lookup('elevenlabs', 'conversational');
  assert.ok(price?.per_minute_usd !== undefined, 'no elevenlabs price row to reconcile against');
  return Math.round((seconds * price.per_minute_usd * 1_000_000) / 60) / 1_000_000;
}

async function llmCallRows(world: AiWorld) {
  return prisma.llmCall.findMany({ where: { interview_id: world.interviewId } });
}

async function spentUsd(world: AiWorld): Promise<string> {
  const row = await prisma.interview.findUniqueOrThrow({ where: { id: world.interviewId } });
  return row.spent_usd.toString();
}

async function postPostCall(world: AiWorld, seconds: number): Promise<void> {
  const raw = JSON.stringify({ interviewId: world.interviewId, seconds });
  const timestamp = Math.floor(clock.now().getTime() / 1000);
  const signature = createHmac('sha256', TEST_SECRET).update(raw).digest('hex');

  const res = await fetch(`${serverState.baseUrl}/webhooks/elevenlabs/post_call`, {
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

/**
 * Runs the queue until `expected` jobs have been processed. Polls the counter rather than
 * `waitUntilFinished`: the job is added `removeOnComplete`, so it can be gone before a
 * QueueEvents listener ever attaches to it.
 */
async function drainReconcileQueue(expected: number): Promise<void> {
  const worker = new Worker<VoiceReconcileJob>(
    VOICE_RECONCILE_QUEUE,
    async (job) => {
      await reconcileVoiceUsage(job.data.interviewId, job.data.seconds, {
        traceId: job.data.traceId,
      });
      processed += 1;
    },
    { connection },
  );
  try {
    const deadline = Date.now() + 20_000;
    while (processed < expected && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(processed, expected, 'the reconciliation job did not run');
  } finally {
    await worker.close();
  }
}

// ---------------------------------------------------------------- given

Given(
  'an interview ran a voice round for {int} seconds',
  async function (this: AiWorld, _seconds: number) {
    // The duration is the webhook's claim, not a stored column — the interview only has to
    // exist in voice mode. No profile step: question generation is stubbed (AI_ENABLED=false)
    // and writes no llm_calls row, which is what lets "exactly one row" mean what it says.
    await signIn.call(this, 'candidate');
    await this.httpPost('/interviews', {
      mode: 'voice',
      jobText: 'Voice interview position — backend developer, remote.',
      targetQuestionCount: 8,
    });
    assert.equal(this.lastStatus, 201, `setup failed: ${JSON.stringify(this.lastBody)}`);
    this.interviewId = (this.lastBody?.interviewId as string | undefined) ?? '';
    assert.equal((await llmCallRows(this)).length, 0, 'the fixture already had an llm_calls row');
  },
);

Given('the interview spent_usd before reconciliation is recorded', async function (this: AiWorld) {
  spentBefore = await spentUsd(this);
  callsBefore = (await llmCallRows(this)).length;
});

// ---------------------------------------------------------------- when

When(
  'ElevenLabs posts the post-call reconciliation webhook reporting {int} seconds',
  async function (this: AiWorld, seconds: number) {
    await postPostCall(this, seconds);
    assert.equal(this.lastStatus, 202, `post_call failed: ${JSON.stringify(this.lastBody)}`);
    await drainReconcileQueue(1);
  },
);

When('the same post-call reconciliation webhook is delivered again', async function (this: AiWorld) {
  callsBefore = (await llmCallRows(this)).length;
  spentBefore = await spentUsd(this);

  await postPostCall(this, 240);
  assert.equal(this.lastStatus, 202, `redelivery failed: ${JSON.stringify(this.lastBody)}`);
  // Two, not one: the second job must actually RUN and no-op inside the transaction. A queue
  // that silently dropped the redelivery would satisfy the assertions below without the
  // idempotency check ever being exercised.
  await drainReconcileQueue(2);
});

// ---------------------------------------------------------------- then

Then('the worker writes exactly one llm_calls row for the interview', async function (this: AiWorld) {
  assert.equal((await llmCallRows(this)).length, 1);
});

Then('that llm_calls row has provider {string}', async function (this: AiWorld, provider: string) {
  const [row] = await llmCallRows(this);
  assert.equal(row.provider, provider);
});

Then('that llm_calls row has unit_kind {string}', async function (this: AiWorld, kind: string) {
  const [row] = await llmCallRows(this);
  assert.equal(row.unit_kind, kind);
});

Then('that llm_calls row has units {int}', async function (this: AiWorld, units: number) {
  const [row] = await llmCallRows(this);
  assert.equal(Number(row.units), units);
});

Then('the interview spent_usd increases by the reconciled voice cost', async function (this: AiWorld) {
  const delta = Number(await spentUsd(this)) - Number(spentBefore);
  assert.equal(delta.toFixed(6), expectedCostUsd(240).toFixed(6));
});

Then(
  'the llm_calls row and the spent_usd update commit in one transaction',
  async function (this: AiWorld) {
    // Asserted by fault injection on a second fixture, because atomicity is only observable
    // when one half fails: `spent_usd` is Decimal(12,6), so an interview parked at the column
    // ceiling makes the increment overflow AFTER the insert has already run. If the two were
    // separate statements the llm_calls row would survive the failed update.
    const owner = await prisma.interview.findUniqueOrThrow({ where: { id: this.interviewId } });
    const probe = await prisma.interview.create({
      data: {
        user_id: owner.user_id,
        mode: 'voice',
        job_text: 'atomicity probe',
        job_source: 'paste',
        occupation: 'probe',
        language: 'en',
        target_question_count: 1,
        hr_question_count: 1,
        spent_usd: '999999.999999',
      },
    });

    await assert.rejects(
      reconcileVoiceUsage(probe.id, 240, { traceId: `trace-${probe.id}` }),
      'the overflowing increment did not fail — the probe proves nothing',
    );
    assert.equal(
      await prisma.llmCall.count({ where: { interview_id: probe.id } }),
      0,
      'the llm_calls row outlived the failed spent_usd update: the two are not one transaction',
    );

    await prisma.interview.delete({ where: { id: probe.id } });
  },
);

Then('no additional llm_calls row is written', async function (this: AiWorld) {
  assert.equal((await llmCallRows(this)).length, callsBefore);
});

Then('the interview spent_usd is unchanged', async function (this: AiWorld) {
  assert.equal(await spentUsd(this), spentBefore);
});
