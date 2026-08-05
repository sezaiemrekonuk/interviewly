/**
 * R03: the failure branch of the report job. Two things are under test — which failures reach
 * the dead-letter at all (`handleReportJobFailed`), and what the dead-letter writes when one
 * does (`handleDeadLetter`). The real 3-attempt retry against Redis is
 * `failure.integration.test.ts`; this file is the queue-free half, same split as R01's.
 *
 * `@interviewly/backend` is mocked whole: its barrel constructs a `PrismaClient` and a BullMQ
 * `Queue` at import time (see `consumer.test.ts`).
 */
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyTransition, prisma, REPORT_JOB_OPTIONS } from '@interviewly/backend';

import { logger } from './lib/logger';

import { handleDeadLetter, handleReportJobFailed } from './failure';
import type { ReportJobData } from './consumer';

vi.mock('@interviewly/backend', () => ({
  applyTransition: vi.fn(),
  prisma: {
    interview: { findFirst: vi.fn() },
    report: { updateMany: vi.fn() },
  },
  REPORT_JOB_OPTIONS: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
  REPORT_QUEUE: 'report',
}));
vi.mock('./lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const applyTransitionMock = vi.mocked(applyTransition);
const findFirstMock = vi.mocked(prisma.interview.findFirst);
const updateManyMock = vi.mocked(prisma.report.updateMany);

/** Only the fields the listener reads; BullMQ's `Job` is far too wide to build here. */
function failedJob(attemptsMade: number, interviewId = 'int-1'): Job<ReportJobData> {
  return {
    id: interviewId,
    data: { interviewId },
    attemptsMade,
    opts: { attempts: 3 },
  } as Job<ReportJobData>;
}

const evaluating = { id: 'int-1', state: 'evaluating' };

/** What `applyTransition` throws on an illegal edge (`ApiError`, F01 code). */
function illegalEdge(): Error {
  return Object.assign(new Error('INVALID_STATE_TRANSITION'), {
    code: 'INVALID_STATE_TRANSITION',
  });
}

/** `[event, level]` of every log line, in order — pino's message is arg 2 (K6). */
function loggedEvents(): [unknown, string][] {
  const of = (level: 'warn' | 'error'): [unknown, string][] =>
    vi.mocked(logger[level]).mock.calls.map(([, event]) => [event, level]);
  return [...of('warn'), ...of('error')];
}

beforeEach(() => {
  vi.clearAllMocks();
  findFirstMock.mockResolvedValue(evaluating as never);
  applyTransitionMock.mockResolvedValue('failed' as never);
  updateManyMock.mockResolvedValue({ count: 1 } as never);
});

describe('report job options (K10)', () => {
  it('is three attempts with exponential backoff from 1s', () => {
    expect(REPORT_JOB_OPTIONS).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });
  });
});

describe('handleReportJobFailed', () => {
  it('does not dead-letter while BullMQ still has attempts left', async () => {
    await handleReportJobFailed(failedJob(1), new Error('AI_PROVIDER_UNAVAILABLE'));
    await handleReportJobFailed(failedJob(2), new Error('AI_PROVIDER_UNAVAILABLE'));

    expect(applyTransitionMock).not.toHaveBeenCalled();
    expect(loggedEvents()).toEqual([
      ['REPORT_JOB_RETRY', 'warn'],
      ['REPORT_JOB_RETRY', 'warn'],
    ]);
  });

  it('dead-letters on the final failed attempt', async () => {
    await handleReportJobFailed(failedJob(3), new Error('AI_PROVIDER_UNAVAILABLE'));

    expect(applyTransitionMock).toHaveBeenCalledOnce();
    expect(loggedEvents()).toContainEqual(['REPORT_DEAD_LETTERED', 'warn']);
  });

  it('never rejects — an unhandled rejection in an event listener kills the worker', async () => {
    findFirstMock.mockRejectedValueOnce(new Error('db is down'));

    await expect(handleReportJobFailed(failedJob(3), new Error('boom'))).resolves.toBeUndefined();
    expect(loggedEvents()).toContainEqual(['REPORT_DEAD_LETTER_FAILED', 'error']);
  });
});

describe('handleDeadLetter', () => {
  it('transitions the interview to failed through applyTransition (K2)', async () => {
    await handleDeadLetter('int-1', new Error('AI_PROVIDER_UNAVAILABLE'));

    expect(applyTransitionMock).toHaveBeenCalledExactlyOnceWith(
      evaluating,
      'failed',
      expect.objectContaining({ traceId: expect.stringContaining('int-1') }),
    );
    expect(loggedEvents()).toEqual([
      ['REPORT_DEAD_LETTERED', 'warn'],
      ['REPORT_JOB_FAILED', 'error'],
    ]);
  });

  it('marks the report row failed, without clobbering a ready one', async () => {
    await handleDeadLetter('int-1', new Error('AI_PROVIDER_UNAVAILABLE'));

    expect(updateManyMock).toHaveBeenCalledExactlyOnceWith({
      where: { interview_id: 'int-1', status: { not: 'ready' } },
      data: { status: 'failed' },
    });
  });

  it('is a no-op when a racing retry already drove the interview terminal', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 'int-1', state: 'completed' } as never);
    applyTransitionMock.mockRejectedValueOnce(illegalEdge());

    await handleDeadLetter('int-1', new Error('AI_PROVIDER_UNAVAILABLE'));

    // The guarded edge is the idempotency, so a rejected transition is the expected outcome —
    // but it must not then rewrite the `ready` row the winning run wrote.
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(loggedEvents()).toContainEqual(['REPORT_DEAD_LETTER_NOOP', 'warn']);
    expect(loggedEvents()).not.toContainEqual(['REPORT_DEAD_LETTERED', 'warn']);
  });

  it('propagates a transition failure that is not the guarded edge', async () => {
    applyTransitionMock.mockRejectedValueOnce(new Error('connection terminated'));

    await expect(handleDeadLetter('int-1', new Error('boom'))).rejects.toThrow(
      'connection terminated',
    );
  });

  it('is a no-op for an interview that is gone (deleted mid-flight)', async () => {
    findFirstMock.mockResolvedValueOnce(null as never);

    await handleDeadLetter('int-1', new Error('boom'));

    expect(applyTransitionMock).not.toHaveBeenCalled();
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it('logs no payload, transcript or stack — the cause is a message (K6)', async () => {
    await handleDeadLetter('int-1', new Error('AI_PROVIDER_UNAVAILABLE'));

    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      { interviewId: 'int-1', reason: 'AI_PROVIDER_UNAVAILABLE' },
      'REPORT_JOB_FAILED',
    );
  });
});
