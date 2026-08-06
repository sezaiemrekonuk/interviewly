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

import type { AiClient, ReportPayload } from '@interviewly/ai';
import { prisma, REPORT_QUEUE, runReport, setStorage } from '@interviewly/backend';

import { finalizeReport, pdfKeyFor } from './finalize';
import { processReportJob, type ReportJobData } from './consumer';

const connection = { url: process.env.REDIS_URL! };

// The object store is in-memory here, unlike Postgres and Redis: the CI `acceptance` job that
// runs this ring stands up neither MinIO nor S3 credentials, and I12's own
// `object_storage.feature` @AC-6 is where the real signed-URL delivery is proven. What R02 owns
// and this asserts is that the bytes land under the key `pdf_key` names.
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
  async remove(key) {
    objects.delete(key);
  },
});

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

  it('stores the rendered PDF and points reports.pdf_key at it', async () => {
    const interviewId = await seedEvaluatingInterview();

    const job = await queue.add(REPORT_QUEUE, { interviewId }, { jobId: interviewId });
    await job.waitUntilFinished(queueEvents, 20_000);

    const report = await prisma.report.findFirstOrThrow({ where: { interview_id: interviewId } });
    expect(report.pdf_key).toBe(pdfKeyFor(interviewId));
    // K12: a private key, never under the public `/assets` prefix `S3_PUBLIC_PREFIX` names.
    expect(report.pdf_key).not.toContain('assets');

    const stored = objects.get(report.pdf_key!);
    expect(stored?.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, 25_000);
});

/**
 * `StubAiClient.generateReport` returns `questions: []`, so the queue-driven tests above can
 * never produce a `report_questions` row. These drive `runReport` with a client that scores the
 * interview's real questions — the only way to see the denormalisation R02's DoD is about.
 */
describe('report artifact over a payload with per-question scores', () => {
  async function seedAnsweredInterview(): Promise<{ interviewId: string; questionIds: string[] }> {
    const interviewId = await seedEvaluatingInterview();
    const persona = await prisma.persona.create({
      data: {
        role: 'hr',
        name: `R02 persona ${randomUUID()}`,
        voice_id: 'stub-voice',
        avatar_set: {},
        system_prompt: 'stub',
      },
    });
    const round = await prisma.interviewRound.create({
      data: { interview_id: interviewId, type: 'hr', persona_id: persona.id },
    });

    const questionIds: string[] = [];
    for (const order_index of [1, 2]) {
      const question = await prisma.question.create({
        data: {
          round_id: round.id,
          order_index,
          text: `Stub question ${order_index}`,
          kind: 'behavioral',
          difficulty: 'medium',
          topic: 'stub-topic',
        },
      });
      await prisma.answer.create({
        data: {
          question_id: question.id,
          transcript: `Stub answer ${order_index}`,
          input_mode: 'text',
          answered_at: new Date(),
        },
      });
      questionIds.push(question.id);
    }
    return { interviewId, questionIds };
  }

  function payloadFor(questionIds: string[]): ReportPayload {
    return {
      overall_impression: 'Stub impression for the R02 artifact path.',
      overall_score: 4,
      strengths: ['Stayed on topic', 'Consistent structure'],
      improvements: ['Add metrics', 'State the outcome'],
      rounds: [{ type: 'hr', score: 4, summary: 'Stub HR round.' }],
      questions: questionIds.map((question_id, i) => ({
        question_id,
        score: 3 + i,
        reason: `Stub reason ${i + 1}`,
        star_adherence: 0.5 + i / 10,
      })),
      language: 'en',
    };
  }

  /** `runReport` calls exactly one method on its client; a full fake would be noise. */
  const clientReturning = (payload: ReportPayload): AiClient =>
    ({ generateReport: async () => payload }) as unknown as AiClient;

  it('denormalises one report_questions row per payload question and stores the PDF', async () => {
    const { interviewId, questionIds } = await seedAnsweredInterview();
    const payload = payloadFor(questionIds);

    await runReport(interviewId, { traceId: 'r02-test', client: clientReturning(payload) });
    await finalizeReport(interviewId);

    const report = await prisma.report.findFirstOrThrow({
      where: { interview_id: interviewId },
      include: { report_questions: true },
    });
    expect(report.pdf_key).toBe(pdfKeyFor(interviewId));
    expect((objects.get(report.pdf_key!))?.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    expect(
      report.report_questions
        .map((row) => ({
          question_id: row.question_id,
          score: row.score,
          reason: row.reason,
          star_adherence: Number(row.star_adherence),
        }))
        .sort((a, b) => a.score - b.score),
    ).toEqual(payload.questions);
  }, 25_000);

  it('re-finalising leaves one object, one pdf_key and no duplicate report_questions', async () => {
    const { interviewId, questionIds } = await seedAnsweredInterview();
    const payload = payloadFor(questionIds);

    await runReport(interviewId, { traceId: 'r02-test', client: clientReturning(payload) });
    await finalizeReport(interviewId);
    const first = objects.get(pdfKeyFor(interviewId));
    await finalizeReport(interviewId);

    const reports = await prisma.report.findMany({
      where: { interview_id: interviewId },
      include: { report_questions: true },
    });
    expect(reports).toHaveLength(1);
    expect(reports[0].pdf_key).toBe(pdfKeyFor(interviewId));
    expect(reports[0].report_questions).toHaveLength(questionIds.length);
    // Same key, and `renderReportPdf` is deterministic, so the second write is byte-identical.
    expect((objects.get(pdfKeyFor(interviewId)))?.equals(first!)).toBe(true);
  }, 25_000);
});
