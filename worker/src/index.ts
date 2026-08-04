import { REPORT_QUEUE, VOICE_RECONCILE_QUEUE, type VoiceReconcileJob } from '@interviewly/backend';
import { Worker } from 'bullmq';

import { processReportJob, type ReportJobData } from './consumer';
import { sendEmail, type EmailJob } from './jobs/email-send';
import { processVoiceReconcileJob } from './jobs/voice-reconcile';
import { config } from './lib/env';
import { logger } from './lib/logger';

/**
 * The worker process. A04 gives it its first consumer (`email.send`); R01 adds the report
 * queue alongside it and V04 the voice reconciliation job.
 */

export const EMAIL_QUEUE_NAME = 'email.send';
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

// R03 adds retry/dead-letter policy; here a failed job just needs to be loud, same as email's.
reportWorker.on('failed', (job, err) => {
  logger.warn(
    { queue: REPORT_QUEUE, interviewId: job?.data?.interviewId, reason: err.message },
    'REPORT_JOB_FAILED',
  );
});

const voiceReconcileWorker = new Worker<VoiceReconcileJob>(
  VOICE_RECONCILE_QUEUE,
  processVoiceReconcileJob,
  { connection: { url: config.REDIS_URL } },
);

// A failed reconciliation under-bills the interview, so it must be loud even while BullMQ
// still has attempts left.
voiceReconcileWorker.on('failed', (job, err) => {
  logger.warn(
    { queue: VOICE_RECONCILE_QUEUE, interviewId: job?.data?.interviewId, reason: err.message },
    'VOICE_RECONCILE_JOB_FAILED',
  );
});

logger.info(
  {
    queues: [EMAIL_QUEUE_NAME, REPORT_QUEUE, VOICE_RECONCILE_QUEUE],
    reportConcurrency: REPORT_CONCURRENCY,
  },
  'WORKER_STARTED',
);

async function shutdown(): Promise<void> {
  await Promise.all([emailWorker.close(), reportWorker.close(), voiceReconcileWorker.close()]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
