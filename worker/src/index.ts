import { Worker } from 'bullmq';

import { sendEmail, type EmailJob } from './jobs/email-send';
import { config } from './lib/env';
import { logger } from './lib/logger';

/**
 * The worker process. A04 gives it its first consumer (`email.send`); R01 adds the report
 * queue alongside it and V04 the voice reconciliation job.
 */

export const EMAIL_QUEUE_NAME = 'email.send';

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

logger.info({ queue: EMAIL_QUEUE_NAME }, 'WORKER_STARTED');

async function shutdown(): Promise<void> {
  await emailWorker.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
