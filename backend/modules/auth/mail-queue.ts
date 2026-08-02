import type { EmailTokenKind } from '@prisma/client';
import { Queue } from 'bullmq';

import { config } from '../../src/lib/env';
import { logger } from '../../src/lib/logger';

/**
 * The API's side of the mail boundary (K8.6): it enqueues, `worker` delivers. The API
 * never opens an SMTP socket, so a mail outage degrades to a queued job instead of a
 * failed registration.
 */

export const EMAIL_QUEUE_NAME = 'email.send';

export interface EmailJob {
  /** Recipient. The only PII this job carries — no name, no password, no session. */
  to: string;
  kind: EmailTokenKind;
  /** Plaintext token. Lives in the payload and in the mail body, nowhere else. */
  token: string;
  locale: string;
}

export interface EmailQueue {
  add(job: EmailJob): Promise<void>;
}

let queue: EmailQueue | undefined;

/**
 * Swaps the queue implementation. The acceptance ring installs a recorder so
 * "exactly one job is enqueued" is an assertion about this call rather than about Redis,
 * and no scenario has to drain a real BullMQ queue to know what happened.
 *
 * Injection rather than a `NODE_ENV === 'test'` branch on purpose: the environment
 * decides configuration, never behaviour (§11.3), and a branch here would mean the code
 * path the scenarios exercise is not the code path that runs in production.
 */
export function setEmailQueue(replacement: EmailQueue | undefined): void {
  queue = replacement;
}

// Retry policy travels with the job, which is where BullMQ reads it from. Five attempts
// over exponential backoff, then the job lands in the failed set: a mail that cannot be
// delivered is something to inspect, never something to redeliver forever.
const ATTEMPTS = 5;
const BACKOFF_MS = 5_000;

/** Constructed on first use, so importing this module opens no Redis connection. */
function bullQueue(): EmailQueue {
  const real = new Queue<EmailJob>(EMAIL_QUEUE_NAME, { connection: { url: config.REDIS_URL } });
  return {
    add: async (job) => {
      await real.add(job.kind, job, {
        attempts: ATTEMPTS,
        backoff: { type: 'exponential', delay: BACKOFF_MS },
        removeOnComplete: true,
      });
    },
  };
}

export function emailQueue(): EmailQueue {
  return (queue ??= bullQueue());
}

/**
 * Enqueue that cannot fail its caller. Registration owes the visitor a session cookie
 * whether or not the mail system is up, so a queue outage is a logged warning and the
 * request continues.
 */
export async function enqueueEmail(job: EmailJob, traceId: string | undefined): Promise<void> {
  try {
    await emailQueue().add(job);
  } catch {
    // No `to`, no token: a failed enqueue is an infrastructure fact, not a place to start
    // logging addresses and credentials.
    logger.warn({ kind: job.kind, traceId }, 'EMAIL_ENQUEUE_FAILED');
  }
}
