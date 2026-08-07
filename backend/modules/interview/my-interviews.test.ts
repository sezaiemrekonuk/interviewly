/**
 * The list is what a progress chart is plotted from, so the score has to ride on the row: a
 * separate `GET /interviews/:id` per item is the N+1 this join exists to kill, and the two
 * properties that keep it dead are asserted together here — the join is on the *page* query,
 * and it asks for a ready report only.
 *
 * `@prisma/client` is faked rather than `src/lib/db`, so the real `userInterviews` runs. Mocking
 * the helper away would leave its `include` — where both of those properties live — untested.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type Args = Record<string, never> & Record<string, unknown>;

const page: Row[] = [];
const findMany = vi.fn(async (_args: Args): Promise<Row[]> => page);
const findFirst = vi.fn(async (_args: Args): Promise<{ id: string } | null> => null);

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    interview = { findMany, findFirst };
  },
}));

const { listMyInterviews } = await import('./my-interviews');

/** A payload as `reports.payload` stores it — snake_case, K15's shape (schemas.ts). */
const payload = {
  overall_impression: 'Solid.',
  overall_score: 4,
  strengths: ['clear', 'structured'],
  improvements: ['more depth', 'more detail'],
  rounds: [
    { type: 'hr', score: 3, summary: 'warm' },
    { type: 'tech', score: 5, summary: 'strong' },
  ],
  questions: [],
  language: 'en',
};

const interview = (reports: Row[]): Row => ({
  id: 'itv_1',
  state: 'completed',
  mode: 'text',
  occupation: 'Backend Engineer',
  ended_reason: 'completed',
  created_at: new Date('2026-01-01T10:00:00.000Z'),
  started_at: new Date('2026-01-01T10:01:00.000Z'),
  ended_at: new Date('2026-01-01T10:21:00.000Z'),
  reports,
});

interface Body {
  items: Record<string, unknown>[];
  nextCursor: string | null;
}

async function call(query: Record<string, string> = {}): Promise<Body> {
  let body: Body | undefined;
  const res = {
    status: () => res,
    json: (value: Body) => {
      body = value;
      return res;
    },
  };
  await listMyInterviews(
    { query, user: { id: 'u1' } } as never,
    res as never,
    (err: unknown) => {
      throw err;
    },
  );
  return body!;
}

beforeEach(() => {
  page.length = 0;
  findMany.mockClear();
  findFirst.mockClear();
});

describe('GET /me/interviews', () => {
  it('carries the report scores on the row', async () => {
    page.push(interview([{ payload }]));

    const { items } = await call();
    expect(items[0]).toMatchObject({
      id: 'itv_1',
      overallScore: 4,
      roundScores: { hr: 3, tech: 5 },
    });
  });

  it('keeps every field the list already returned', async () => {
    page.push(interview([{ payload }]));

    expect(Object.keys((await call()).items[0])).toEqual([
      'id',
      'state',
      'mode',
      'occupation',
      'endedReason',
      'createdAt',
      'startedAt',
      'endedAt',
      'overallScore',
      'roundScores',
    ]);
  });

  // A report that is queued or failed arrives as an empty list, because the query filters it
  // out — which is the same thing an interview with no report at all looks like.
  it('nulls the scores when no ready report joined', async () => {
    page.push(interview([]));

    expect((await call()).items[0]).toMatchObject({
      overallScore: null,
      roundScores: { hr: null, tech: null },
    });
  });

  it('asks for the newest ready report, one per interview', async () => {
    await call();

    expect(findMany.mock.calls[0][0].include).toEqual({
      reports: {
        where: { status: 'ready' },
        orderBy: { created_at: 'desc' },
        take: 1,
        select: { payload: true },
      },
    });
  });

  // The whole point of the join: one round trip for the page, not one per row.
  it('reads the page in a single query', async () => {
    page.push(interview([{ payload }]), interview([{ payload }]), interview([]));

    await call();
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('nulls a round the interview never had rather than inventing one', async () => {
    page.push(interview([{ payload: { ...payload, rounds: [payload.rounds[0]] } }]));

    expect((await call()).items[0]).toMatchObject({
      overallScore: 4,
      roundScores: { hr: 3, tech: null },
    });
  });

  // Stored JSON, so this is a real branch: a payload that no longer parses must cost its own
  // row a score, not 500 a page where every other interview is fine.
  it('degrades a malformed payload to nulls instead of throwing', async () => {
    page.push(interview([{ payload: { overall_score: 'four', rounds: 'none' } }]), interview([{ payload }]));

    const { items } = await call();
    expect(items[0]).toMatchObject({ overallScore: null, roundScores: { hr: null, tech: null } });
    expect(items[1]).toMatchObject({ overallScore: 4 });
  });

  it('still scopes and pages exactly as before', async () => {
    page.push(interview([]), interview([]));

    const { nextCursor } = await call({ limit: '1' });
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { user_id: 'u1', deleted_at: null },
      orderBy: { created_at: 'desc' },
      take: 2,
    });
    expect(nextCursor).toBe(Buffer.from('itv_1').toString('base64url'));
  });
});
