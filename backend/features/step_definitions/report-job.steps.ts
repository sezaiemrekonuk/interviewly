/**
 * `report.feature` @report @AC-20 — the real worker path (R01).
 *
 * `report-run.steps.ts` (@AC-11, schema_validation.feature) calls `runReport` directly to test
 * the schema gate in isolation. This scenario is the opposite: it drives the whole chain for
 * real — an HTTP answer transitions the interview to `evaluating`, which fires I07's
 * `enqueueReport` (`reportQueue.add`, `jobId = interviewId`), and only THEN does a BullMQ
 * `Worker` dequeue that job and call `runReport`. The worker built here mirrors
 * `worker/src/consumer.ts`'s processor step for step; it is not imported from `worker/` because
 * cucumber runs entirely against backend source via tsx and never builds worker/'s dist (see
 * ci.yml's `acceptance` job) — importing it would silently depend on a stale or absent build.
 */
import assert from 'node:assert/strict';
import { After, Given, Then, When } from '@cucumber/cucumber';
import { QueueEvents, Worker, type Job } from 'bullmq';

import { config } from '../../src/lib/env';
import { prisma } from '../../src/lib/db';
import { redis } from '../../modules/auth/rate-limit';
import { applyTransition } from '../../modules/interview/machine';
import { runReport } from '../../modules/interview/report-run';
import { enqueueReport } from '../../modules/interview/sse';
import { REPORT_QUEUE, reportQueue } from '../../src/lib/queue';

import { signInAsAdmin } from './admin.steps';
import { arriveAtQuestion } from './answers.steps';
import { serverState } from './server';
import { AiWorld } from './world';

const TOTAL_QUESTIONS = 5;
const connection = { url: config.REDIS_URL };

// Scenario-local, not on the World — same convention as `lastAnsweredQuestionId` in
// answers.steps.ts, reset below rather than threaded through AiWorld.
let sseWanted = false;
let sseChunks = '';
let sseReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
let reportJobTimestamp: number | undefined;

After(async function closeSseAndResetReportJobState() {
  await sseReader?.cancel().catch(() => undefined);
  sseWanted = false;
  sseChunks = '';
  sseReader = undefined;
  reportJobTimestamp = undefined;
});

async function connectSse(world: AiWorld): Promise<void> {
  const res = await fetch(`${serverState.baseUrl}/interviews/${world.interviewId}/events`, {
    headers: world.cookie ? { cookie: world.cookie } : {},
  });
  assert.equal(res.status, 200, 'SSE connection failed');
  const reader = res.body!.getReader();
  sseReader = reader;
  const decoder = new TextDecoder();
  void (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      sseChunks += decoder.decode(value);
    }
  })();
}

// ---------------------------------------------------------------- given

Given('I have an open SSE connection to GET {string}', function (_path: string) {
  // Path is taken, not read: the feature's "/events/interviews/:id" pre-dates the real route
  // (`/interviews/:id/events`, sse.ts). No interview exists yet at this point in the
  // scenario, so the connection itself opens once the id is known — the next `Given`.
  sseWanted = true;
});

Given(
  'I am on the last technical question of an interview',
  async function (this: AiWorld) {
    await arriveAtQuestion(this, TOTAL_QUESTIONS, TOTAL_QUESTIONS);
    if (sseWanted) await connectSse(this);
  },
);

// ---------------------------------------------------------------- when

// "I submit an answer for the current question" is I08's (budget.steps.ts) and already reads
// `current_index` — a second definition here is ambiguous, not additive. The `Given` above
// leaves the interview on the last technical question, which is what makes that generic step
// submit the answer that trips `→ evaluating`.

When('evaluating is entered again for the same interviewId', async function (this: AiWorld) {
  // No re-evaluate endpoint exists (interviews.state is never written directly outside
  // applyTransition) — this calls the exact hook `machine.ts` calls on every entry to
  // `evaluating`, which is what AC-20's idempotency claim is about.
  await enqueueReport(this.interviewId, { traceId: `trace-${this.interviewId}` });
});

When('the report job completes for the interview', async function (this: AiWorld) {
  const job = await reportQueue.getJob(this.interviewId);
  assert.ok(job, 'no report job was enqueued for this interview');

  const queueEvents = new QueueEvents(REPORT_QUEUE, { connection });
  const worker = new Worker(
    REPORT_QUEUE,
    async (queuedJob: Job<{ interviewId: string }>) => {
      await runReport(queuedJob.data.interviewId, { traceId: `trace-${queuedJob.data.interviewId}` });
    },
    { connection },
  );
  try {
    await job.waitUntilFinished(queueEvents, 20_000);
  } finally {
    await worker.close();
    await queueEvents.close();
  }
});

// ---------------------------------------------------------------- then

Then(
  'exactly one report job is enqueued for the interviewId',
  async function (this: AiWorld) {
    const job = await reportQueue.getJob(this.interviewId);
    assert.ok(job, 'no report job was enqueued for this interview');
    reportJobTimestamp = job.timestamp;
  },
);

Then('the SSE stream emits an interview nudge', async function () {
  const deadline = Date.now() + 3_000;
  while (!sseChunks.includes('event: INTERVIEW_STATE_CHANGED') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(
    sseChunks.includes('event: INTERVIEW_STATE_CHANGED'),
    `no state-change nudge on the SSE stream: ${sseChunks}`,
  );
});

Then('no additional report job is enqueued', async function (this: AiWorld) {
  const job = await reportQueue.getJob(this.interviewId);
  assert.ok(job, 'the original report job disappeared');
  assert.equal(job.timestamp, reportJobTimestamp, 'a second job replaced the original');
});

Then('the response contains the ready report', function (this: AiWorld) {
  const body = this.lastBody as { report?: { status?: string; payload?: unknown } } | undefined;
  assert.equal(body?.report?.status, 'ready', `body: ${JSON.stringify(body)}`);
  assert.ok(body?.report?.payload, 'no payload on the ready report');
});

// ── issue 081: POST /admin/interviews/:id/report/requeue ──────────────────────
//
// The scenarios above prove the happy path enqueues exactly once. These prove the hole under
// it: that single enqueue rides on the `→ evaluating` edge, so a job that is lost or exhausted
// used to leave the interview in `evaluating` with no report and no way to ask for one again.

/**
 * The interview owner's session, parked before an admin actor overwrites `world.cookie`.
 * Idempotent, so a scenario that requeues more than once keeps the first (candidate) jar.
 */
function parkCandidate(world: AiWorld): void {
  world.actors.candidate ??= world.cookie;
}

async function requeueAs(world: AiWorld, cookie: string): Promise<void> {
  world.cookie = cookie;
  await world.httpPost(`/admin/interviews/${world.interviewId}/report/requeue`, {});
  // Restored immediately: every step after this one reads the interview as its owner, and
  // `GET /interviews/:id` is 404 INTERVIEW_NOT_FOUND for anyone else (ADR-I11).
  world.cookie = world.actors.candidate;
}

// ---------------------------------------------------------------- when

When('the report job fails until its retry budget is exhausted', async function (this: AiWorld) {
  const job = await reportQueue.getJob(this.interviewId);
  assert.ok(job, 'no report job was enqueued for this interview');

  // A processor that always throws burns all three attempts under `REPORT_JOB_OPTIONS`, which
  // is the real R03 shape — not a job deleted out of Redis. The exhausted job stays retained
  // under `jobId = interviewId`, and that retention is precisely what the requeue has to get
  // past: `reportQueue.add` for an id the queue still remembers is a silent no-op.
  //
  // `handleReportJobFailed` is deliberately NOT wired here. Without it the dead-letter never
  // runs and the interview sits in `evaluating` with no report — the live shape issue 081
  // found four of.
  const queueEvents = new QueueEvents(REPORT_QUEUE, { connection });
  const worker = new Worker(
    REPORT_QUEUE,
    async () => {
      throw new Error('forced report job loss');
    },
    { connection },
  );
  try {
    await assert.rejects(job.waitUntilFinished(queueEvents, 20_000));
  } finally {
    await worker.close();
    await queueEvents.close();
  }
});

When('the report job is deleted from Redis', async function (this: AiWorld) {
  // Byte for byte the issue's own reproduction step — `redis-cli del bull:report:<interviewId>`
  // — rather than `reportQueue.remove`, which is the call the endpoint makes and would prove
  // nothing about a job the queue never got to clean up itself.
  //
  // This is the branch the retained-job scenarios cannot reach: `remove` answers 1 for a job
  // that is merely absent, so a requeue that gated on its return code would refuse exactly the
  // case issue 081 was filed about. Pins that.
  const deleted = await redis.del(`bull:${REPORT_QUEUE}:${this.interviewId}`);
  assert.equal(deleted, 1, 'the report job hash was not there to delete');
});

Then('no report job exists for the interviewId', async function (this: AiWorld) {
  assert.equal(await reportQueue.getJob(this.interviewId), undefined);
});

When('the interview is dead-lettered with no report row', async function (this: AiWorld) {
  // What R03's `handleDeadLetter` leaves behind once the retries are gone: state `failed`, and
  // no `reports` row at all — I09 only ever creates one on the success branch. Driven through
  // `applyTransition` rather than a direct write for the reason K2 exists: nothing in this
  // system writes `interviews.state` any other way.
  const interview = await prisma.interview.findUniqueOrThrow({ where: { id: this.interviewId } });
  await applyTransition(interview, 'failed', { traceId: `trace-${this.interviewId}` });
  assert.equal(
    await prisma.report.count({ where: { interview_id: this.interviewId } }),
    0,
    'the dead-letter fixture must leave no report row',
  );
});

When('an unauthenticated client requeues the report for the interview', async function (this: AiWorld) {
  parkCandidate(this);
  await requeueAs(this, '');
});

When('a non-admin requeues the report for the interview', async function (this: AiWorld) {
  parkCandidate(this);
  await requeueAs(this, this.actors.candidate);
});

When('an admin requeues the report for the interview', async function (this: AiWorld) {
  parkCandidate(this);
  await requeueAs(this, await signInAsAdmin(this));
});

// ---------------------------------------------------------------- then

Then('the report job is retained in the failed set', async function (this: AiWorld) {
  const job = await reportQueue.getJob(this.interviewId);
  assert.ok(job, 'the exhausted job must still resolve under jobId = interviewId');
  assert.equal(await job.getState(), 'failed');
});

Then('exactly one report row exists for the interview', async function (this: AiWorld) {
  assert.equal(await prisma.report.count({ where: { interview_id: this.interviewId } }), 1);
});
