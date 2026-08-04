/**
 * The queue-free half of R01's coverage: what `processReportJob` itself owns, which is the
 * `traceId` it derives, the failure it must not swallow, and the K6 log pair around the call.
 * `consumer.integration.test.ts` covers the other half — the real BullMQ dequeue against a
 * real `runReport` — and needs Postgres and Redis, which the CI `unit` job has neither of.
 *
 * `@interviewly/backend` is mocked whole rather than just `runReport`: its barrel
 * (`worker-exports.ts`) constructs a `PrismaClient` and a BullMQ `Queue` at import time, so
 * loading it for real is exactly the connection this file exists to avoid.
 */
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runReport } from '@interviewly/backend';

import { logger } from './lib/logger';

import { processReportJob, type ReportJobData } from './consumer';

vi.mock('@interviewly/backend', () => ({ runReport: vi.fn() }));
vi.mock('./lib/logger', () => ({ logger: { info: vi.fn() } }));

const runReportMock = vi.mocked(runReport);
const infoMock = vi.mocked(logger.info);

/** Only the two fields the processor reads; BullMQ's `Job` is far too wide to build here. */
function fakeJob(interviewId: string, jobId = interviewId): Job<ReportJobData> {
  return { id: jobId, data: { interviewId } } as Job<ReportJobData>;
}

/** The `EVENT_NAME` of every `logger.info` call, in order — pino's message is arg 2 (K6). */
function loggedEvents(): unknown[] {
  return infoMock.mock.calls.map(([, event]) => event);
}

describe('processReportJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the report for the job\'s interview under a job-scoped traceId', async () => {
    await processReportJob(fakeJob('int-1', 'job-7'));

    expect(runReportMock).toHaveBeenCalledExactlyOnceWith('int-1', { traceId: 'worker-job-7' });
  });

  it('logs the K6 lifecycle pair around a successful run', async () => {
    await processReportJob(fakeJob('int-1', 'job-7'));

    expect(loggedEvents()).toEqual(['REPORT_JOB_STARTED', 'REPORT_JOB_COMPLETED']);
    expect(infoMock).toHaveBeenNthCalledWith(
      1,
      { interviewId: 'int-1', jobId: 'job-7' },
      'REPORT_JOB_STARTED',
    );
  });

  it('propagates a runReport failure so BullMQ fails the job (R03 retries on this)', async () => {
    runReportMock.mockRejectedValueOnce(new Error('schema gate rejected the transcript'));

    await expect(processReportJob(fakeJob('int-1'))).rejects.toThrow(
      'schema gate rejected the transcript',
    );
    // The COMPLETED line is the signal R01 emits for a report that actually landed; a failed
    // run must not produce one.
    expect(loggedEvents()).toEqual(['REPORT_JOB_STARTED']);
  });
});
