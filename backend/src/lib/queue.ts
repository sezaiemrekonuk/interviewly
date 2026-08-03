/**
 * The `report` job producer (R01, ADR-R01). One `Queue` instance, shared by `api` (the
 * `enqueueReport` hook in `modules/interview/sse.ts`) and `worker` (the consumer) — both
 * import this module rather than constructing their own `Queue`, so the name and the
 * connection can never drift between producer and consumer.
 */
import { Queue } from 'bullmq';

import { config } from './env';

export const REPORT_QUEUE = 'report';

export const reportQueue = new Queue(REPORT_QUEUE, {
  connection: { url: config.REDIS_URL },
});
