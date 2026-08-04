/**
 * R01 integration coverage for the report queue: a real BullMQ `Worker` running
 * `processReportJob`, dequeuing a job this file enqueues itself, driving the real
 * `runReport` (I09) end to end. Needs `AI_ENABLED=false` (the repo default outside a
 * developer's own `.env` — see `packages/ai`'s `resolveAiClient`), which resolves to
 * `StubAiClient` and keeps this fast, free and deterministic without injecting a client into
 * `runReport` (production never does).
 *
 * `report-run.ts`'s unit-ish coverage (the acceptance `report-run.steps.ts`) calls `runReport`
 * directly; this is the one thing that cannot reach — the queue itself.
 *
 * NOT part of `npm test`: `*.integration.test.ts` is excluded by `worker/vitest.config.mts`
 * unless INTEGRATION=1, because the CI `unit` job runs with no Postgres and no Redis at all,
 * and `.env.example`'s `db:5432`/`cache:6379` are compose-internal hostnames that resolve
 * nowhere else. The queue-free half of this coverage lives in `consumer.test.ts`. Run this one
 * where both servers exist — the CI `acceptance` job does, and locally:
 *
 *   # -f compose.dev.yaml is what publishes the ports to the host; cache lands on 6380
 *   docker compose -f compose.yaml -f compose.dev.yaml up -d db cache
 *   export DATABASE_URL=postgresql://interviewly:interviewly@localhost:5432/interviewly
 *   export REDIS_URL=redis://localhost:6380
 *   npm run test:integration
 */
import { randomUUID } from 'node:crypto';

import { Queue, QueueEvents, Worker } from 'bullmq';
import { afterAll, describe, expect, it } from 'vitest';

import { prisma, REPORT_QUEUE } from '@interviewly/backend';

import { processReportJob, type ReportJobData } from './consumer';

const connection = { url: process.env.REDIS_URL! };

async function seedEvaluatingInterview(): Promise<string> {
  const user = await prisma.user.create({
    data: { email_lower: `r01-${randomUUID()}@test.local` },
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

describe('report queue consumer', () => {
  const queue = new Queue(REPORT_QUEUE, { connection });
  const queueEvents = new QueueEvents(REPORT_QUEUE, { connection });
  const worker = new Worker<ReportJobData>(REPORT_QUEUE, processReportJob, { connection });

  afterAll(async () => {
    await worker.close();
    await queueEvents.close();
    await queue.close();
  });

  it(
    'dequeues the job, runs runReport, and leaves the report ready',
    async () => {
      const interviewId = await seedEvaluatingInterview();

      const job = await queue.add(REPORT_QUEUE, { interviewId }, { jobId: interviewId });
      await job.waitUntilFinished(queueEvents, 20_000);

      const report = await prisma.report.findFirst({ where: { interview_id: interviewId } });
      expect(report?.status).toBe('ready');

      const interview = await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } });
      expect(interview.state).toBe('completed');
    },
    25_000,
  );

  it('is idempotent per interviewId (jobId dedup, AC-20)', async () => {
    const interviewId = await seedEvaluatingInterview();

    const first = await queue.add(REPORT_QUEUE, { interviewId }, { jobId: interviewId });
    const second = await queue.add(REPORT_QUEUE, { interviewId }, { jobId: interviewId });

    // A re-add for a known jobId returns the same job rather than creating a second one —
    // the mechanism AC-20's "no additional report job is enqueued" relies on.
    expect(second.id).toBe(first.id);
    expect((await queue.getJob(interviewId))?.id).toBe(interviewId);

    await first.waitUntilFinished(queueEvents, 20_000);
  }, 25_000);
});
