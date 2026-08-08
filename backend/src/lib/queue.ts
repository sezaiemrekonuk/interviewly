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
  // Issue #72: with no retention every job ever run stayed in Redis forever, and the queues are
  // the only unbounded key space in there — every other key is written with an EX.
  //
  // Bounded by age and count rather than `true`, because the retained id is also what makes
  // `jobId = interviewId` refuse a duplicate enqueue. A day is far longer than any re-entry
  // that dedup is meant to catch; past it the guarantee is the database's, not Redis' — a
  // unique `reports.interview_id` and the create-only write in `report-run.ts`.
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  // Kept longer on purpose: a failed job is the dead-letter record, and with LOG_TRANSPORT
  // stdout it is the only durable trace of an interview that never produced a report.
  removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
} satisfies JobsOptions;

export const reportQueue = new Queue(REPORT_QUEUE, {
  connection: { url: config.REDIS_URL },
  defaultJobOptions: REPORT_JOB_OPTIONS,
});
