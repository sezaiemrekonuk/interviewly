/**
 * The `report` job producer (R01, ADR-R01). One `Queue` instance, shared by `api` (the
 * `enqueueReport` hook in `modules/interview/sse.ts`) and `worker` (the consumer) — both
 * import this module rather than constructing their own `Queue`, so the name and the
 * connection can never drift between producer and consumer.
 */
import { Queue, type JobsOptions } from 'bullmq';

import { config } from './env';

export const REPORT_QUEUE = 'report';

/**
 * R03/K10. Attempts and backoff are *job* options, so they belong to the producer even though
 * the worker owns what happens when they run out — set as queue defaults rather than at the
 * single `add` call so a future producer cannot enqueue an unretried report job. The worker's
 * dead-letter listener reads them back to recognise the final attempt.
 */
export const REPORT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
} satisfies JobsOptions;

export const reportQueue = new Queue(REPORT_QUEUE, {
  connection: { url: config.REDIS_URL },
  defaultJobOptions: REPORT_JOB_OPTIONS,
});

export const VOICE_RECONCILE_QUEUE = 'voice.reconcile';

// V04. Same producer/consumer sharing as `report` above.
export const voiceReconcileQueue = new Queue(VOICE_RECONCILE_QUEUE, {
  connection: { url: config.REDIS_URL },
});
