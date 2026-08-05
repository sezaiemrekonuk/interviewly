import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyTransition, prisma } from '@interviewly/backend';

import { logger } from '../lib/logger';

import { sweepAbandoned } from './abandon-sweep';

vi.mock('@interviewly/backend', () => ({
  applyTransition: vi.fn(),
  prisma: {
    interview: { findMany: vi.fn() },
    chatMessage: { groupBy: vi.fn() },
  },
}));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const findManyMock = vi.mocked(prisma.interview.findMany);
const groupByMock = vi.mocked(prisma.chatMessage.groupBy);
const applyTransitionMock = vi.mocked(applyTransition);

const now = new Date('2026-08-05T12:00:00.000Z');
const hour = 60 * 60 * 1000;

function interview(
  id: string,
  state: string,
  startedAt: Date | null,
  createdAt: Date,
): {
  id: string;
  state: string;
  started_at: Date | null;
  created_at: Date;
  ended_reason: null;
} {
  return { id, state, started_at: startedAt, created_at: createdAt, ended_reason: null };
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
    groupByMock.mockResolvedValue([] as never);
    applyTransitionMock.mockResolvedValue('abandoned' as never);
  });

  it('sweeps stale profiling/hr_round/paused rows to abandoned with ended reason', async () => {
    findManyMock.mockResolvedValue(
      [
        interview('int-p', 'profiling', null, new Date(now.getTime() - 50 * hour)),
        interview('int-h', 'hr_round', null, new Date(now.getTime() - 50 * hour)),
        interview('int-z', 'paused', null, new Date(now.getTime() - 50 * hour)),
      ] as never,
    );
    groupByMock.mockResolvedValue([
      { interview_id: 'int-p', _max: { created_at: new Date(now.getTime() - 30 * hour) } },
      { interview_id: 'int-h', _max: { created_at: new Date(now.getTime() - 40 * hour) } },
      { interview_id: 'int-z', _max: { created_at: new Date(now.getTime() - 25 * hour) } },
    ] as never);

    await sweepAbandoned();

    expect(applyTransitionMock).toHaveBeenCalledTimes(3);
    expect(applyTransitionMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'int-p' }),
      'abandoned',
      expect.objectContaining({ endedReason: 'abandoned', traceId: expect.any(String) }),
    );
    expect(applyTransitionMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'int-h' }),
      'abandoned',
      expect.objectContaining({ endedReason: 'abandoned', traceId: expect.any(String) }),
    );
    expect(applyTransitionMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ id: 'int-z' }),
      'abandoned',
      expect.objectContaining({ endedReason: 'abandoned', traceId: expect.any(String) }),
    );
    // The state the interview left, not the state `applyTransition` wrote back onto the row.
    expect(payloads('info', 'INTERVIEW_ABANDONED')).toEqual([
      { interviewId: 'int-p', from: 'profiling' },
      { interviewId: 'int-h', from: 'hr_round' },
      { interviewId: 'int-z', from: 'paused' },
    ]);
  });

  it('queries only non-deleted stale-able states, bounded, so created/tech_round/evaluating/terminal/soft-deleted rows never reach the loop', async () => {
    await sweepAbandoned();

    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        deleted_at: null,
        state: { in: ['profiling', 'hr_round', 'paused'] },
      },
      select: {
        id: true,
        state: true,
        started_at: true,
        created_at: true,
        ended_reason: true,
      },
      orderBy: { created_at: 'asc' },
      take: 500,
    });
    expect(applyTransitionMock).not.toHaveBeenCalled();
  });

  it('does not sweep interviews whose derived last activity is under 24 h', async () => {
    findManyMock.mockResolvedValue(
      [
        // Never messaged, but started just now: `started_at` is the last-activity signal.
        interview('int-fresh', 'paused', now, new Date(now.getTime() - 50 * hour)),
        // Old row, old start, but answered a turn an hour ago.
        interview(
          'int-msg',
          'hr_round',
          new Date(now.getTime() - 50 * hour),
          new Date(now.getTime() - 50 * hour),
        ),
        // Never started, never messaged, created inside the window.
        interview('int-new', 'profiling', null, new Date(now.getTime() - 2 * hour)),
      ] as never,
    );
    groupByMock.mockResolvedValue([
      { interview_id: 'int-msg', _max: { created_at: new Date(now.getTime() - 1 * hour) } },
    ] as never);

    await sweepAbandoned();

    expect(applyTransitionMock).not.toHaveBeenCalled();
  });

  it('is idempotent and race-safe: invalid transition on rerun is a skip', async () => {
    findManyMock.mockResolvedValue([
      interview('int-1', 'paused', null, new Date(now.getTime() - 50 * hour)),
    ] as never);
    groupByMock.mockResolvedValue([
      { interview_id: 'int-1', _max: { created_at: new Date(now.getTime() - 50 * hour) } },
    ] as never);
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
      interview('int-1', 'hr_round', null, new Date(now.getTime() - 30 * hour)),
      interview('int-2', 'paused', null, new Date(now.getTime() - 30 * hour)),
    ] as never);
    groupByMock.mockResolvedValue([
      { interview_id: 'int-1', _max: { created_at: new Date(now.getTime() - 30 * hour) } },
      { interview_id: 'int-2', _max: { created_at: new Date(now.getTime() - 30 * hour) } },
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
      Array.from({ length: 500 }, (_, index) =>
        interview(`int-${index}`, 'paused', null, new Date(now.getTime() - 50 * hour)),
      ) as never,
    );

    await sweepAbandoned();

    expect(payloads('info', 'INTERVIEW_ABANDON_SWEEP_COMPLETED')).toEqual([
      { candidates: 500, stale: 500, swept: 500, skipped: 0, failed: 0, truncated: true },
    ]);
  });
});
