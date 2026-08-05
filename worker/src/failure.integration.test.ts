/**
 * R03 against a real BullMQ: the retry policy itself. `failure.test.ts` covers what the
 * dead-letter writes; this covers *when it runs* — how many times a thrown job is actually
 * retried, that a job which recovers on attempt 3 lands normally, and that the schema-gate
 * branch is not retried at all. `attemptsMade` semantics are a bullmq detail, so asserting them
 * against a stub proves nothing; only the real queue does.
 *
 * NOT part of `npm test` — needs Postgres and Redis. Same as `consumer.integration.test.ts`:
 *
 *   docker compose -f compose.yaml -f compose.dev.yaml up -d db cache
 *   export DATABASE_URL=postgresql://interviewly:interviewly@localhost:5432/interviewly
 *   export REDIS_URL=redis://localhost:6380
 *   npm run test:integration
 */
import { randomUUID } from 'node:crypto';

import { Queue, QueueEvents, Worker, type Job, type Processor } from 'bullmq';
import { describe, expect, it } from 'vitest';

import type { AiClient, ReportPayload } from '@interviewly/ai';
import { prisma, REPORT_JOB_OPTIONS, REPORT_QUEUE, runReport, setStorage } from '@interviewly/backend';

import { handleReportJobFailed } from './failure';
import { processReportJob, type ReportJobData } from './consumer';

const connection = { url: process.env.REDIS_URL! };

const objects = new Map<string, Buffer>();
setStorage({
  async put(key, bytes) {
    objects.set(key, bytes);
  },
  async get(key) {
    const bytes = objects.get(key);
    if (!bytes) throw new Error(`no object at ${key}`);
    return bytes;
  },
  async signedUrl(key) {
    return `memory://${key}`;
  },
});

async function seedEvaluatingInterview(): Promise<string> {
  const user = await prisma.user.create({
    data: { email_lower: `r03-${randomUUID()}@test.local` },
  });
  const interview = await prisma.interview.create({
    data: {
      user_id: user.id,
      mode: 'text',
      job_text: 'Backend engineer, Postgres experience.',
      job_source: 'paste',
      occupation: 'Backend Engineer',
      language: 'en',
      target_question_count: 5,
      hr_question_count: 3,
      state: 'evaluating',
    },
  });
  return interview.id;
}

interface Ring {
  /** Enqueues under `REPORT_JOB_OPTIONS` and resolves once the job is finished *and* the
   *  `failed` listener has finished with it — the dead-letter write is what the test asserts. */
  run(interviewId: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * One queue per test rather than the shared `report` name: these workers deliberately throw, and
 * a job left over from a failing test would otherwise be picked up by the next test's processor.
 * The retry policy under test rides on the job, not on the name.
 */
async function ring(processor: Processor<ReportJobData>): Promise<Ring> {
  const name = `${REPORT_QUEUE}.r03-${randomUUID()}`;
  const queue = new Queue<ReportJobData>(name, { connection, defaultJobOptions: REPORT_JOB_OPTIONS });
  const events = new QueueEvents(name, { connection });
  const worker = new Worker<ReportJobData>(name, processor, { connection });

  // The production wiring is `void handleReportJobFailed(...)`. Here the handler's promise is
  // kept, because `waitUntilFinished` resolves off `QueueEvents` and can win the race against
  // this process's own listener — asserting straight after it would read the row too early.
  let onLastAttempt: () => void;
  const lastAttemptHandled = new Promise<void>((resolve) => (onLastAttempt = resolve));
  worker.on('failed', (job, err) => {
    const handled = handleReportJobFailed(job, err);
    if ((job?.attemptsMade ?? 0) >= (job?.opts?.attempts ?? 1)) void handled.then(onLastAttempt);
  });

  return {
    async run(interviewId) {
      const job = await queue.add(name, { interviewId }, { jobId: interviewId });
      const failed = await job.waitUntilFinished(events, 20_000).then(
        () => false,
        () => true,
      );
      if (failed) await lastAttemptHandled;
    },
    async close() {
      await worker.close();
      await events.close();
      await queue.close();
    },
  };
}

describe('transient report failure', () => {
  it('retries and lands normally when the third attempt succeeds', async () => {
    const interviewId = await seedEvaluatingInterview();
    let attempts = 0;
    const r = await ring(async (job: Job<ReportJobData>) => {
      attempts += 1;
      if (attempts < 3) throw new Error('AI_PROVIDER_UNAVAILABLE');
      await processReportJob(job);
    });

    try {
      await r.run(interviewId);

      expect(attempts).toBe(3);
      const interview = await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } });
      expect(interview.state).toBe('completed');
      // Exactly one terminal transition and one report: the two failed attempts wrote nothing.
      const reports = await prisma.report.findMany({ where: { interview_id: interviewId } });
      expect(reports).toHaveLength(1);
      expect(reports[0].status).toBe('ready');
    } finally {
      await r.close();
    }
  }, 30_000);

  it('dead-letters to failed after three attempts and no further retry', async () => {
    const interviewId = await seedEvaluatingInterview();
    let attempts = 0;
    const r = await ring(async () => {
      attempts += 1;
      throw new Error('AI_PROVIDER_UNAVAILABLE');
    });

    try {
      await r.run(interviewId);

      expect(attempts).toBe(3);
      const interview = await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } });
      expect(interview.state).toBe('failed');
      // The job never reached `runReport`, so there is no row to mark — the interview state is
      // the durable dead-letter signal (see `handleDeadLetter`).
      expect(await prisma.report.findMany({ where: { interview_id: interviewId } })).toHaveLength(0);
    } finally {
      await r.close();
    }
  }, 30_000);

  it('is idempotent: a second dead-letter on a terminal interview changes nothing', async () => {
    const interviewId = await seedEvaluatingInterview();
    const r = await ring(async () => {
      throw new Error('AI_PROVIDER_UNAVAILABLE');
    });

    try {
      await r.run(interviewId);
      const after = await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } });

      await handleReportJobFailed(
        { id: interviewId, data: { interviewId }, attemptsMade: 3, opts: { attempts: 3 } } as Job<ReportJobData>,
        new Error('AI_PROVIDER_UNAVAILABLE'),
      );

      const again = await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } });
      expect(again.state).toBe('failed');
      // `applyTransition` rejects the second `failed → failed` edge, so nothing is rewritten.
      expect(again).toEqual(after);
    } finally {
      await r.close();
    }
  }, 30_000);
});

describe('schema-gate failure (I09)', () => {
  /** `runReport` calls exactly one method on its client; a full fake would be noise. */
  const clientReturning = (payload: ReportPayload): AiClient =>
    ({ generateReport: async () => payload }) as unknown as AiClient;

  // `overall_score` is 0..5 in `ReportPayloadSchema`; 7 is the canonical gate rejection.
  const invalidPayload = {
    overall_impression: 'Rejected by the gate.',
    overall_score: 7,
    strengths: ['Stayed on topic', 'Consistent structure'],
    improvements: ['Add metrics', 'State the outcome'],
    rounds: [{ type: 'hr', score: 4, summary: 'Stub HR round.' }],
    questions: [],
    language: 'en',
  } as unknown as ReportPayload;

  it('completes on the first attempt — never retried, no artifact', async () => {
    const interviewId = await seedEvaluatingInterview();
    let attempts = 0;
    // Mirrors `processReportJob` with the one thing the consumer cannot inject: a client whose
    // payload fails the gate. The branch under test is `runReport` returning without throwing.
    const r = await ring(async (job: Job<ReportJobData>) => {
      attempts += 1;
      await runReport(job.data.interviewId, {
        traceId: `worker-${job.id}`,
        client: clientReturning(invalidPayload),
      });
    });

    try {
      await r.run(interviewId);

      expect(attempts).toBe(1);
      const interview = await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } });
      expect(interview.state).toBe('failed');
      // K15: no row, so no payload, no `report_questions`, no `pdf_key`.
      expect(await prisma.report.findMany({ where: { interview_id: interviewId } })).toHaveLength(0);
      expect(objects.has(`reports/${interviewId}.pdf`)).toBe(false);
    } finally {
      await r.close();
    }
  }, 30_000);
});
