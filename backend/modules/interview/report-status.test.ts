/**
 * Issue #123: `reports.status` is a four-value enum that only ever held `ready`. The row was
 * created at the end of a successful run and the failure path wrote none at all, so an
 * in-flight report and a lost one looked identical from the database — which is why the stuck
 * `evaluating` interviews of issues 025/026 could only be found by hand.
 *
 * What is pinned here is the lifecycle *and* the exclusivity it had to keep: the ready write
 * used to be "did my insert succeed", and over a row that now already exists it has to be a
 * compare-and-set instead. Getting that wrong would let a redelivered job overwrite a
 * finished report, which is the one thing this file is more afraid of than a wrong status.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The `reports` table, as much of it as this unit needs. */
interface Row {
  interview_id: string;
  status: 'queued' | 'generating' | 'ready' | 'failed';
  payload?: unknown;
}

let rows: Row[] = [];

const matches = (row: Row, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([key, value]) => {
    const actual = (row as unknown as Record<string, unknown>)[key];
    if (value && typeof value === 'object' && 'not' in (value as Record<string, unknown>)) {
      return actual !== (value as { not: unknown }).not;
    }
    if (value && typeof value === 'object' && 'in' in (value as Record<string, unknown>)) {
      return (value as { in: unknown[] }).in.includes(actual);
    }
    return actual === value;
  });

const report = {
  upsert: vi.fn(async ({ where, create }: { where: { interview_id: string }; create: Row }) => {
    if (!rows.some((r) => r.interview_id === where.interview_id)) rows.push({ ...create });
    return rows.find((r) => r.interview_id === where.interview_id)!;
  }),
  updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
    const hit = rows.filter((r) => matches(r, where));
    hit.forEach((r) => Object.assign(r, data));
    return { count: hit.length };
  }),
  findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
    rows.find((r) => matches(r, where)) ?? null,
  ),
  count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
    rows.filter((r) => matches(r, where)).length,
  ),
};

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    report = report;
  },
}));

const { openReportRow } = await import('./report-row');
const { prisma } = await import('../../src/lib/db');

/** The compare-and-set `runReport` performs once the payload is in hand. */
async function claimReady(interviewId: string): Promise<boolean> {
  const claimed = await prisma.report.updateMany({
    where: { interview_id: interviewId, status: { not: 'ready' } },
    data: { status: 'ready', payload: { ok: true } } as never,
  });
  return claimed.count > 0;
}

describe('the report row lifecycle', () => {
  beforeEach(() => {
    rows = [];
  });

  it('opens as queued when the job is enqueued, not when the run finishes', async () => {
    await openReportRow('itw_1');

    expect(rows).toEqual([
      expect.objectContaining({ interview_id: 'itw_1', status: 'queued' }),
    ]);
  });

  it('is idempotent, so a requeue re-opens the same row', async () => {
    await openReportRow('itw_1');
    await openReportRow('itw_1');

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('queued');
  });

  it('walks a failed row back to queued, so a retry is visible as one', async () => {
    await openReportRow('itw_1');
    rows[0].status = 'failed';

    await openReportRow('itw_1');

    expect(rows[0].status).toBe('queued');
  });

  it('never re-opens a finished report — that is a deliverable, not a retry', async () => {
    await openReportRow('itw_1');
    rows[0].status = 'ready';

    await openReportRow('itw_1');

    expect(rows[0].status).toBe('ready');
  });

  describe('the ready write is a compare-and-set', () => {
    it('lets exactly one caller win, and the loser writes nothing', async () => {
      await openReportRow('itw_1');

      expect(await claimReady('itw_1')).toBe(true);
      // A redelivered job arriving after the first finished. Under the old create-and-catch
      // this was "the insert failed"; over a row that already exists it has to be the status.
      expect(await claimReady('itw_1')).toBe(false);
      expect(rows[0].status).toBe('ready');
    });

    it('claims a generating row, which is the ordinary path', async () => {
      await openReportRow('itw_1');
      rows[0].status = 'generating';

      expect(await claimReady('itw_1')).toBe(true);
    });
  });

  it('leaves every status reachable, which is the whole defect', async () => {
    await openReportRow('itw_1');
    const seen = new Set<string>([rows[0].status]);

    await prisma.report.updateMany({
      where: { interview_id: 'itw_1', status: { in: ['queued', 'failed'] } },
      data: { status: 'generating' } as never,
    });
    seen.add(rows[0].status);

    await prisma.report.updateMany({
      where: { interview_id: 'itw_1', status: { not: 'ready' } },
      data: { status: 'failed' } as never,
    });
    seen.add(rows[0].status);

    await claimReady('itw_1');
    seen.add(rows[0].status);

    expect([...seen].sort()).toEqual(['failed', 'generating', 'queued', 'ready']);
  });
});
