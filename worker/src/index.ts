import { REPORT_QUEUE } from '@interviewly/backend';
import { Queue, Worker } from 'bullmq';

import { processReportJob, type ReportJobData } from './consumer';
import { handleReportJobFailed } from './failure';
import { sendEmail, type EmailJob } from './jobs/email-send';
import { sweepAbandoned } from './jobs/abandon-sweep';
import { config } from './lib/env';
import { logger } from './lib/logger';

/**
 * The worker process. A04 gives it its first consumer (`email.send`); R01 adds the report
 * queue alongside it. S05 removed V04's voice reconciliation job (ADR-S04).
 */

export const EMAIL_QUEUE_NAME = 'email.send';
export const ABANDON_SWEEP_QUEUE_NAME = 'interview.abandon-sweep';
const ABANDON_SWEEP_JOB_NAME = 'interview.abandon-sweep';
const ABANDON_SWEEP_JOB_ID = 'interview-abandon-sweep-v1';
const ABANDON_SWEEP_EVERY_MS = 15 * 60 * 1000;
// K10: report generation is the one LLM-bound job in this process, low concurrency by design
// (env.ts exposes no override yet — a fixed constant until a task needs to tune it).
const REPORT_CONCURRENCY = 2;

const emailWorker = new Worker<EmailJob>(
  EMAIL_QUEUE_NAME,
  async (job) => {
    await sendEmail(job.data);
  },
  { connection: { url: config.REDIS_URL } },
);

// The producer sets attempts and backoff (they are job options, not worker options); this
// side only reports. A job whose remaining attempts are exhausted has dead-lettered into
// BullMQ's failed set, which is where an operator retries it from.
emailWorker.on('failed', (job, err) => {
  const attemptsMade = job?.attemptsMade ?? 0;
  const exhausted = attemptsMade >= (job?.opts.attempts ?? 1);
  // `err.message` only: a nodemailer failure quotes the envelope, so the recipient would
  // ride into the log with the stack if the whole error were serialised.
  logger.warn(
    { queue: EMAIL_QUEUE_NAME, attemptsMade, reason: err.message },
    exhausted ? 'EMAIL_DEAD_LETTERED' : 'EMAIL_SEND_RETRY',
  );
});

const reportWorker = new Worker<ReportJobData>(
  REPORT_QUEUE,
  processReportJob,
  { connection: { url: config.REDIS_URL }, concurrency: REPORT_CONCURRENCY },
);

// R03. `attempts`/`backoff` ride on the job (queue defaults in `backend/src/lib/queue.ts`), so
// this side only has to recognise the attempt that exhausted them and dead-letter it.
// `handleReportJobFailed` never rejects — see its note.
reportWorker.on('failed', (job, err) => {
  void handleReportJobFailed(job, err);
});

const abandonSweepQueue = new Queue(ABANDON_SWEEP_QUEUE_NAME, {
  connection: { url: config.REDIS_URL },
});

const abandonSweepWorker = new Worker(
  ABANDON_SWEEP_QUEUE_NAME,
  async () => {
    await sweepAbandoned();
  },
  { connection: { url: config.REDIS_URL } },
);

// `queue.add({ repeat })` is gone in bullmq 6 — `repeat` is not in `JobsOptions` and an
// object literal carrying it does not compile. A scheduler is the only repeatable API left,
// and its `jobSchedulerId` is the fixed identity this task needs: a worker restart upserts
// the one scheduler instead of stacking a second one.
void abandonSweepQueue
  .upsertJobScheduler(
    ABANDON_SWEEP_JOB_ID,
    { every: ABANDON_SWEEP_EVERY_MS, immediately: true },
    { name: ABANDON_SWEEP_JOB_NAME, opts: { removeOnComplete: true } },
  )
  .then(() => {
    logger.info(
      {
        queue: ABANDON_SWEEP_QUEUE_NAME,
        jobId: ABANDON_SWEEP_JOB_ID,
        everyMs: ABANDON_SWEEP_EVERY_MS,
      },
      'INTERVIEW_ABANDON_SWEEP_SCHEDULED',
    );
  })
  .catch((err) => {
    logger.error(
      { queue: ABANDON_SWEEP_QUEUE_NAME, reason: err.message },
      'INTERVIEW_ABANDON_SWEEP_SCHEDULE_FAILED',
    );
  });

abandonSweepWorker.on('failed', (job, err) => {
  logger.warn(
    { queue: ABANDON_SWEEP_QUEUE_NAME, jobId: job?.id, reason: err.message },
    'INTERVIEW_ABANDON_SWEEP_FAILED',
  );
});

logger.info(
  {
    queues: [
      EMAIL_QUEUE_NAME,
      REPORT_QUEUE,
      ABANDON_SWEEP_QUEUE_NAME,
    ],
    reportConcurrency: REPORT_CONCURRENCY,
  },
  'WORKER_STARTED',
);

async function shutdown(): Promise<void> {
  await Promise.all([
    emailWorker.close(),
    reportWorker.close(),
    abandonSweepWorker.close(),
    abandonSweepQueue.close(),
  ]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
