import { setEmailQueue, type EmailJob } from '../../modules/auth/mail-queue';

/**
 * Stands in for BullMQ during acceptance. `exactly one "email.send" job is enqueued` is
 * then a statement about the producer, which is the part A04 owns — draining a real queue
 * would test BullMQ and add a Redis round-trip to every registration scenario.
 *
 * The consumer side (`worker/src/jobs/email-send.ts`) is covered by the booted-stack half
 * of the task's Verification, where a real mail lands in the Mailpit inbox.
 */

let jobs: EmailJob[] = [];

export function installMailRecorder(): void {
  setEmailQueue({
    add: async (job) => {
      jobs.push(job);
    },
  });
}

export function resetMailRecorder(): void {
  jobs = [];
}

export function recordedJobs(): EmailJob[] {
  return jobs;
}

/** The plaintext token from the newest job for an address — the link the person clicks. */
export function latestTokenFor(email: string): string | undefined {
  return [...jobs].reverse().find((j) => j.to === email.trim().toLowerCase())?.token;
}
