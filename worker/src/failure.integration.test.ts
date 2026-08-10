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
import { describe, expect, it, vi } from 'vitest';

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
  async remove(key) {
    objects.delete(key);
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

/** As above, plus one answered question — `report_questions` needs a real FK to denormalise to. */
async function seedAnsweredInterview(): Promise<{ interviewId: string; questionId: string }> {
  const interviewId = await seedEvaluatingInterview();
  const persona = await prisma.persona.create({
    data: {
      role: 'hr',
      name: 'Stub Persona',
      voice_id: 'stub',
      avatar_set: {},
      system_prompt: 'stub',
    },
  });
  const round = await prisma.interviewRound.create({
    data: { interview_id: interviewId, type: 'hr', persona_id: persona.id },
  });
  const question = await prisma.question.create({
    data: {
      round_id: round.id,
      order_index: 1,
      text: 'Tell me about a project you owned.',
      kind: 'behavioral',
      difficulty: 'medium',
      topic: 'ownership',
    },
  });
  await prisma.answer.create({
    data: {
      question_id: question.id,
      transcript: 'I owned the ingest pipeline end to end.',
      input_mode: 'text',
      answered_at: new Date(),
    },
  });
  return { interviewId, questionId: question.id };
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

describe('crash between the report write and the transition (issue 082)', () => {
  /** A payload the gate accepts, keyed to a question that really exists. */
  const clientScoring = (questionId: string): AiClient =>
    ({
      generateReport: async () => ({
        overall_impression: 'Answered the question and stayed on topic.',
        overall_score: 60,
        strengths: ['Stayed on topic', 'Consistent structure'],
        improvements: ['Add metrics', 'State the outcome'],
        rounds: [{ type: 'hr', score: 60, summary: 'Stub HR round.' }],
        questions: [
          { question_id: questionId, score: 60, reason: 'Clear ownership.', star_adherence: 0.6 },
        ],
        language: 'en',
      }),
    }) as unknown as AiClient;

  it('leaves evaluating with a report row, and the retry completes it without duplicating', async () => {
    const { interviewId, questionId } = await seedAnsweredInterview();
    let attempts = 0;
    let stateAfterCrash: string | undefined;

    // `applyTransition` is the only `interview.updateMany` on this path, so failing the first
    // call is exactly the crash window: the report transaction has committed, the state has not.
    const crash = vi
      .spyOn(prisma.interview, 'updateMany')
      .mockImplementationOnce(() => {
        throw new Error('worker killed between commits');
      });

    const r = await ring(async (job: Job<ReportJobData>) => {
      attempts += 1;
      try {
        await runReport(job.data.interviewId, {
          traceId: `worker-${job.id}`,
          client: clientScoring(questionId),
        });
      } catch (err) {
        // Read the wreckage the first attempt left before the retry repairs it.
        if (attempts === 1) {
          stateAfterCrash = (
            await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } })
          ).state;
        }
        throw err;
      }
    });

    try {
      await r.run(interviewId);

      expect(attempts).toBe(2);
      // The whole point: the crash window is recoverable because the interview never left
      // `evaluating`, and the report it did write was already durable.
      expect(stateAfterCrash).toBe('evaluating');
      expect(
        await prisma.report.count({ where: { interview_id: interviewId, status: 'ready' } }),
      ).toBe(1);

      const interview = await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } });
      expect(interview.state).toBe('completed');

      const reports = await prisma.report.findMany({ where: { interview_id: interviewId } });
      expect(reports).toHaveLength(1);
      expect(
        await prisma.reportQuestion.findMany({ where: { report_id: reports[0].id } }),
      ).toHaveLength(1);
    } finally {
      crash.mockRestore();
      await r.close();
    }
  }, 30_000);

  // The regression guard. The test above passes under the old write order too (it fails the
  // FIRST commit, which is harmless either way); this one fails the SECOND, which is the crash
  // window. Under `transition -> report` it leaves `completed` with no report and nothing able
  // to re-enqueue — the bug in issue 082.
  it('never leaves completed with no report when the report write is the commit that dies', async () => {
    const { interviewId, questionId } = await seedAnsweredInterview();
    let attempts = 0;
    let stateAfterCrash: string | undefined;

    // `$transaction` is only the report write here: the injected client bypasses the chain, so
    // nothing else on this path opens one.
    const crash = vi.spyOn(prisma, '$transaction').mockImplementationOnce(() => {
      throw new Error('worker killed during the report write');
    });

    const r = await ring(async (job: Job<ReportJobData>) => {
      attempts += 1;
      try {
        await runReport(job.data.interviewId, {
          traceId: `worker-${job.id}`,
          client: clientScoring(questionId),
        });
      } catch (err) {
        if (attempts === 1) {
          stateAfterCrash = (
            await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } })
          ).state;
        }
        throw err;
      }
    });

    try {
      await r.run(interviewId);

      expect(attempts).toBe(2);
      expect(stateAfterCrash).toBe('evaluating');

      const interview = await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } });
      expect(interview.state).toBe('completed');
      expect(await prisma.report.count({ where: { interview_id: interviewId } })).toBe(1);
    } finally {
      crash.mockRestore();
      await r.close();
    }
  }, 30_000);

  // The write is no longer behind the `evaluating → completed` CAS, and BullMQ redelivers a
  // stalled job — so two runs of this function can overlap. No queue here: `runReport` twice,
  // concurrently, is the shape that matters.
  it('two concurrent runs write one report and one row per question', async () => {
    const { interviewId, questionId } = await seedAnsweredInterview();
    const run = () =>
      runReport(interviewId, { traceId: `concurrent-${randomUUID()}`, client: clientScoring(questionId) });

    const results = await Promise.allSettled([run(), run()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    // The loser fails on the CAS, which `processReportJob` swallows — not on a unique violation,
    // which would fail its job and burn a retry.
    const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((loser.reason as { code?: string }).code).toBe('INVALID_STATE_TRANSITION');

    const reports = await prisma.report.findMany({ where: { interview_id: interviewId } });
    expect(reports).toHaveLength(1);
    expect(await prisma.reportQuestion.count({ where: { report_id: reports[0].id } })).toBe(1);
    expect(
      (await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } })).state,
    ).toBe('completed');
  }, 30_000);
});

describe('schema-gate failure (I09)', () => {
  /** `runReport` calls exactly one method on its client; a full fake would be noise. */
  const clientReturning = (payload: ReportPayload): AiClient =>
    ({ generateReport: async () => payload }) as unknown as AiClient;

  // `overall_score` is 0..100 in `ReportPayloadSchema`; 101 is the canonical gate rejection.
  const invalidPayload = {
    overall_impression: 'Rejected by the gate.',
    overall_score: 101,
    strengths: ['Stayed on topic', 'Consistent structure'],
    improvements: ['Add metrics', 'State the outcome'],
    rounds: [{ type: 'hr', score: 80, summary: 'Stub HR round.' }],
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
