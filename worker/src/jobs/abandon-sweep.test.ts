/**
 * The staleness predicate itself is SQL now, so it is asserted where it can actually run:
 * `abandon-sweep.integration.test.ts`, against a real Postgres. What is left here is the
 * loop's behaviour around it — the transition arguments, the skip/failure branches, and the
 * query shape the integration ring depends on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyTransition, prisma } from '@interviewly/backend';

import { logger } from '../lib/logger';

import { sweepAbandoned } from './abandon-sweep';

vi.mock('@interviewly/backend', () => ({
  applyTransition: vi.fn(),
  prisma: { interview: { findMany: vi.fn() } },
}));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const findManyMock = vi.mocked(prisma.interview.findMany);
const applyTransitionMock = vi.mocked(applyTransition);

const now = new Date('2026-08-05T12:00:00.000Z');
const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

function interview(id: string, state: string): { id: string; state: string; ended_reason: null } {
  return { id, state, ended_reason: null };
}

function invalidTransition(): Error {
  return Object.assign(new Error('INVALID_STATE_TRANSITION'), {
    code: 'INVALID_STATE_TRANSITION',
  });
}

function events(level: 'info' | 'warn' | 'error'): unknown[] {
  return vi.mocked(logger[level]).mock.calls.map(([, event]) => event);
}

function payloads(level: 'info' | 'warn' | 'error', event: string): Record<string, unknown>[] {
  return vi
    .mocked(logger[level])
    .mock.calls.filter(([, name]) => name === event)
    .map(([payload]) => payload as Record<string, unknown>);
}

describe('sweepAbandoned', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([] as never);
    applyTransitionMock.mockResolvedValue('abandoned' as never);
  });

  it('asks the database for stale, non-deleted, stale-able rows only — bounded', async () => {
    await sweepAbandoned();

    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        deleted_at: null,
        state: { in: ['profiling', 'hr_round', 'paused'] },
        created_at: { lt: cutoff },
        OR: [{ started_at: null }, { started_at: { lt: cutoff } }],
        chat_messages: { none: { created_at: { gte: cutoff } } },
      },
      // `ended_at` is read by `applyTransition`, which will not re-stamp a row that already
      // carries one — an absent column here would read as "never ended".
      select: { id: true, state: true, ended_reason: true, ended_at: true },
      orderBy: { created_at: 'asc' },
      take: 500,
    });
    expect(applyTransitionMock).not.toHaveBeenCalled();
  });

  it('ends every returned row as abandoned with ended reason', async () => {
    findManyMock.mockResolvedValue(
      [
        interview('int-p', 'profiling'),
        interview('int-h', 'hr_round'),
        interview('int-z', 'paused'),
      ] as never,
    );

    await sweepAbandoned();

    expect(applyTransitionMock).toHaveBeenCalledTimes(3);
    for (const [index, id] of ['int-p', 'int-h', 'int-z'].entries()) {
      expect(applyTransitionMock).toHaveBeenNthCalledWith(
        index + 1,
        expect.objectContaining({ id }),
        'abandoned',
        expect.objectContaining({ endedReason: 'abandoned', traceId: expect.any(String) }),
      );
    }
    // The state the interview left, not the state `applyTransition` wrote back onto the row.
    expect(payloads('info', 'INTERVIEW_ABANDONED')).toEqual([
      { interviewId: 'int-p', from: 'profiling' },
      { interviewId: 'int-h', from: 'hr_round' },
      { interviewId: 'int-z', from: 'paused' },
    ]);
  });

  it('is idempotent and race-safe: invalid transition on rerun is a skip', async () => {
    findManyMock.mockResolvedValue([interview('int-1', 'paused')] as never);
    applyTransitionMock.mockResolvedValueOnce('abandoned' as never);
    applyTransitionMock.mockRejectedValueOnce(invalidTransition());

    await expect(sweepAbandoned()).resolves.toBeUndefined();
    await expect(sweepAbandoned()).resolves.toBeUndefined();

    expect(applyTransitionMock).toHaveBeenCalledTimes(2);
    expect(payloads('info', 'INTERVIEW_ABANDONED')).toHaveLength(1);
    expect(events('warn')).toContain('INTERVIEW_ABANDON_SKIP');
  });

  it('continues the batch when one row fails unexpectedly', async () => {
    findManyMock.mockResolvedValue([
      interview('int-1', 'hr_round'),
      interview('int-2', 'paused'),
    ] as never);
    applyTransitionMock.mockRejectedValueOnce(new Error('db timeout'));
    applyTransitionMock.mockResolvedValueOnce('abandoned' as never);

    await expect(sweepAbandoned()).resolves.toBeUndefined();

    expect(applyTransitionMock).toHaveBeenCalledTimes(2);
    expect(events('error')).toContain('INTERVIEW_ABANDON_FAILED');
    expect(payloads('info', 'INTERVIEW_ABANDONED')).toEqual([
      { interviewId: 'int-2', from: 'paused' },
    ]);
  });

  it('flags a full batch as truncated so the summary does not read as a clean table', async () => {
    findManyMock.mockResolvedValue(
      Array.from({ length: 500 }, (_, index) => interview(`int-${index}`, 'paused')) as never,
    );

    await sweepAbandoned();

    expect(payloads('info', 'INTERVIEW_ABANDON_SWEEP_COMPLETED')).toEqual([
      { stale: 500, swept: 500, skipped: 0, failed: 0, truncated: true },
    ]);
  });
});
