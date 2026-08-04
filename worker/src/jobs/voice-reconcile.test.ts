/**
 * V04's worker-level test: the same payload delivered twice reconciles exactly once.
 *
 * `@interviewly/backend` is mocked whole, same reason as `consumer.test.ts` — its barrel
 * constructs a `PrismaClient` and two BullMQ `Queue`s at import time, and the CI `unit` job
 * has neither Postgres nor Redis. The transaction itself is asserted against a real database
 * by `voice_reconciliation.feature` @AC-7, which drives `reconcileVoiceUsage` directly.
 */
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileVoiceUsage, type VoiceReconcileJob } from '@interviewly/backend';

import { logger } from '../lib/logger';

import { processVoiceReconcileJob } from './voice-reconcile';

vi.mock('@interviewly/backend', () => ({ reconcileVoiceUsage: vi.fn() }));
vi.mock('../lib/logger', () => ({ logger: { info: vi.fn() } }));

const reconcileMock = vi.mocked(reconcileVoiceUsage);
const infoMock = vi.mocked(logger.info);

function fakeJob(data: Partial<VoiceReconcileJob> = {}, jobId = 'int-1'): Job<VoiceReconcileJob> {
  return {
    id: jobId,
    data: { interviewId: 'int-1', seconds: 240, traceId: 'trace-1', ...data },
  } as Job<VoiceReconcileJob>;
}

function loggedEvents(): unknown[] {
  return infoMock.mock.calls.map(([, event]) => event);
}

describe('processVoiceReconcileJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reconcileMock.mockResolvedValue({ reconciled: true });
  });

  it('reconciles the job\'s seconds under the traceId the webhook minted', async () => {
    await processVoiceReconcileJob(fakeJob());

    expect(reconcileMock).toHaveBeenCalledExactlyOnceWith('int-1', 240, { traceId: 'trace-1' });
  });

  it('a redelivered payload reconciles once and skips the second time', async () => {
    // What the in-transaction existence check returns on a redelivery: the row is already
    // there, nothing is written, `spent_usd` is untouched.
    reconcileMock.mockResolvedValueOnce({ reconciled: true });
    reconcileMock.mockResolvedValueOnce({ reconciled: false });

    await processVoiceReconcileJob(fakeJob());
    await processVoiceReconcileJob(fakeJob());

    expect(loggedEvents()).toEqual([
      'VOICE_RECONCILE_JOB_COMPLETED',
      'VOICE_RECONCILE_JOB_SKIPPED',
    ]);
  });

  it('logs the completion with the interviewId and the reconciled units', async () => {
    await processVoiceReconcileJob(fakeJob({ seconds: 240 }, 'job-9'));

    expect(infoMock).toHaveBeenCalledExactlyOnceWith(
      { traceId: 'trace-1', interviewId: 'int-1', units: 240, jobId: 'job-9' },
      'VOICE_RECONCILE_JOB_COMPLETED',
    );
  });

  it('propagates a failure so BullMQ retries rather than under-billing silently', async () => {
    reconcileMock.mockRejectedValueOnce(new Error('deadlock detected'));

    await expect(processVoiceReconcileJob(fakeJob())).rejects.toThrow('deadlock detected');
    expect(loggedEvents()).toEqual([]);
  });
});
