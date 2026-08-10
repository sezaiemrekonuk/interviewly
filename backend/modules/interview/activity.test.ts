/**
 * What the month window is, and what a bad month does.
 *
 * The SQL itself is asserted through the bound parameters rather than executed: whether
 * `date_trunc` groups correctly is Postgres's business, but which half-open range the handler
 * asks for is the handler's, and an off-by-one there silently drops the first or the last day
 * of every month.
 */
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryRaw = vi.fn();
vi.mock('../../src/lib/db', () => ({ prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) } }));

const { monthActivity } = await import('./activity');

/** The tagged-template values, in order — `[strings, ...values]` per call. */
const boundValues = (call: unknown[]) => call.slice(1);

function activity(month: unknown) {
  const json = vi.fn();
  const res = { status: vi.fn(() => ({ json })) } as unknown as Response;
  const req = { query: { month }, user: { id: 'usr_1' } } as unknown as Request;

  const handler = monthActivity as unknown as (
    req: Request,
    res: Response,
    next: () => void,
  ) => Promise<void>;

  return { json, run: () => handler(req, res, vi.fn()) };
}

beforeEach(() => {
  queryRaw.mockReset();
  queryRaw
    .mockResolvedValueOnce([
      { date: '2026-08-03', count: 2 },
      { date: '2026-08-11', count: 1 },
    ])
    .mockResolvedValueOnce([{ earliest: '2026-05' }]);
});

describe('monthActivity', () => {
  it('asks for a half-open month, so no day lands in two months or in none', async () => {
    await activity('2026-08').run();

    expect(boundValues(queryRaw.mock.calls[0])).toEqual([
      'usr_1',
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-09-01T00:00:00.000Z'),
    ]);
  });

  it('rolls the year over in December', async () => {
    await activity('2026-12').run();

    expect(boundValues(queryRaw.mock.calls[0])[2]).toEqual(new Date('2027-01-01T00:00:00.000Z'));
  });

  it('answers the days, the scale and where the history starts', async () => {
    const { run, json } = activity('2026-08');
    await run();

    expect(json).toHaveBeenCalledWith({
      month: '2026-08',
      days: [
        { date: '2026-08-03', count: 2 },
        { date: '2026-08-11', count: 1 },
      ],
      // The busiest day of the month being shown — the scale the client shades against.
      max: 2,
      earliest: '2026-05',
    });
  });

  it('answers max 0 for a month with nothing in it', async () => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ earliest: null }]);

    const { run, json } = activity('2026-02');
    await run();

    expect(json).toHaveBeenCalledWith({ month: '2026-02', days: [], max: 0, earliest: null });
  });

  // A month that does not exist is a client bug, and answering it as if it were December would
  // hide that bug behind a plausible grid.
  it.each(['2026-13', '2026-00', '2026-8', 'august', '', undefined, ['2026-08']])(
    'refuses %s',
    async (month) => {
      await expect(activity(month).run()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(queryRaw).not.toHaveBeenCalled();
    },
  );
});
