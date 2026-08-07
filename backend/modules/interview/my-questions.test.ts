/**
 * `GET /me/questions` is a cross-interview read, so its `where` is the only thing standing
 * between one candidate and every other candidate's answers. That makes the query shape the
 * subject here, not just the projection: a filter applied in JS after the fetch would satisfy
 * a body assertion and still have read the rows.
 *
 * `@prisma/client` is faked so the handler's real query is observable — `src/lib/db` exports
 * the client this endpoint uses directly, and mocking it would hide the predicate under test.
 */
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type Args = Record<string, never> & Record<string, unknown>;

/** Cuid-shaped, because `decodeCursor` rejects anything else before a query is ever made. */
const CURSOR_ID = 'cmsd33kvl0005oy0zn7j28sq1';

const page: Row[] = [];
const resolvedCursor: { value: { id: string } | null } = { value: null };
const findMany = vi.fn(async (_args: Args): Promise<Row[]> => page);
const findFirst = vi.fn(async (_args: Args) => resolvedCursor.value);

vi.mock('@prisma/client', async (importActual) => ({
  ...(await importActual<object>()),
  PrismaClient: class {
    answer = { findMany, findFirst };
  },
}));

const { listMyQuestions } = await import('./my-questions');

/** K4's stored score — snake_case, as `adaptive.ts` writes it (schemas.ts §ScoresSchema). */
const storedScores = {
  overall: 4,
  relevance: 4,
  depth: 3,
  structure: 5,
  star_adherence: 0.8,
  reasons: ['Concrete example, thin on outcome.'],
};

const answer = (over: Row = {}, question: Row = {}): Row => ({
  id: 'ans_1',
  answered_at: new Date('2026-01-02T09:00:00.000Z'),
  duration_ms: 42_000,
  scores: storedScores,
  question: {
    id: 'qst_1',
    text: 'Tell me about a conflict you resolved.',
    round: { type: 'hr', interview: { id: 'itv_1', occupation: 'Backend Engineer' } },
    report_questions: [
      { score: 4, reason: 'Named the outcome.', star_adherence: new Prisma.Decimal('0.75') },
    ],
    ...question,
  },
  ...over,
});

interface Body {
  items: Record<string, unknown>[];
  nextCursor: string | null;
}

async function call(query: Record<string, string> = {}, userId = 'u1'): Promise<Body> {
  let body: Body | undefined;
  const res = {
    status: () => res,
    json: (value: Body) => {
      body = value;
      return res;
    },
  };
  await listMyQuestions({ query, user: { id: userId } } as never, res as never, (err: unknown) => {
    throw err;
  });
  return body!;
}

beforeEach(() => {
  page.length = 0;
  resolvedCursor.value = null;
  findMany.mockClear();
  findFirst.mockClear();
});

describe('GET /me/questions', () => {
  it('returns the answered turn, its grade and its per-answer scores', async () => {
    page.push(answer());

    expect((await call()).items).toEqual([
      {
        questionId: 'qst_1',
        interviewId: 'itv_1',
        occupation: 'Backend Engineer',
        roundType: 'hr',
        text: 'Tell me about a conflict you resolved.',
        answeredAt: new Date('2026-01-02T09:00:00.000Z'),
        durationMs: 42_000,
        score: 4,
        reason: 'Named the outcome.',
        starAdherence: 0.75,
        answerScores: {
          overall: 4,
          relevance: 4,
          depth: 3,
          structure: 5,
          starAdherence: 0.8,
          reasons: ['Concrete example, thin on outcome.'],
        },
      },
    ]);
  });

  // A Decimal survives `JSON.stringify` as a string, which no chart can plot.
  it('ships star_adherence as a number, not a Decimal', async () => {
    page.push(answer());

    const { starAdherence } = (await call()).items[0];
    expect(typeof starAdherence).toBe('number');
  });

  it('nulls the grade for a turn no ready report covered', async () => {
    page.push(answer({}, { report_questions: [] }));

    expect((await call()).items[0]).toMatchObject({
      score: null,
      reason: null,
      starAdherence: null,
    });
  });

  // THE security boundary. Ownership has to be a predicate on the query — a body assertion
  // passes just as well when the rows were fetched and then filtered in JS.
  it('scopes to the signed-in user in the query, not afterwards', async () => {
    await call({}, 'u-other');

    expect(findMany.mock.calls[0][0].where).toEqual({
      question: { round: { interview: { user_id: 'u-other', deleted_at: null } } },
    });
  });

  it('excludes soft-deleted interviews (K13)', async () => {
    await call();

    const { where } = findMany.mock.calls[0][0] as { where: Record<string, never> };
    expect(JSON.stringify(where)).toContain('"deleted_at":null');
  });

  it('reads the page in one query, never one per question', async () => {
    page.push(answer({ id: 'ans_1' }), answer({ id: 'ans_2' }), answer({ id: 'ans_3' }));

    await call();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('orders newest first with a unique tiebreak, or the page seam repeats a row', async () => {
    await call();

    expect(findMany.mock.calls[0][0].orderBy).toEqual([
      { answered_at: 'desc' },
      { id: 'desc' },
    ]);
  });

  describe('pagination', () => {
    it('emits a cursor only when a further page exists', async () => {
      page.push(answer({ id: 'ans_1' }), answer({ id: 'ans_2' }));

      const { items, nextCursor } = await call({ limit: '1' });
      expect(findMany.mock.calls[0][0].take).toBe(2); // limit + 1: the probe row
      expect(items).toHaveLength(1);
      expect(nextCursor).toBe(Buffer.from('ans_1').toString('base64url'));
    });

    it('has no cursor on the last page', async () => {
      page.push(answer({ id: 'ans_1' }));

      expect((await call({ limit: '1' })).nextCursor).toBeNull();
    });

    it('resolves a cursor against the same ownership predicate before paging on it', async () => {
      resolvedCursor.value = { id: CURSOR_ID };
      await call({ cursor: Buffer.from(CURSOR_ID).toString('base64url') });

      expect(findFirst.mock.calls[0][0].where).toMatchObject({
        question: { round: { interview: { user_id: 'u1', deleted_at: null } } },
      });
      expect(findMany.mock.calls[0][0]).toMatchObject({ cursor: { id: CURSOR_ID }, skip: 1 });
    });

    // Another user's cursor resolves to nothing, so it pages from the start rather than
    // handing back a foothold in their list.
    it('falls back to page one when the cursor is not the caller\'s', async () => {
      resolvedCursor.value = null;
      await call({ cursor: Buffer.from(CURSOR_ID).toString('base64url') });

      expect(findMany.mock.calls[0][0]).not.toHaveProperty('cursor');
    });
  });

  // `answers.scores` is stored JSON nothing re-validates on write-out. One bad row must not
  // take down a page the rest of which is fine.
  it('nulls a malformed answers.scores instead of throwing', async () => {
    page.push(
      answer({ id: 'ans_1', scores: { overall: 'excellent' } }),
      answer({ id: 'ans_2', scores: null }),
      answer({ id: 'ans_3' }),
    );

    const { items } = await call();
    expect(items[0].answerScores).toBeNull();
    expect(items[1].answerScores).toBeNull();
    expect(items[2].answerScores).toMatchObject({ overall: 4 });
  });
});
