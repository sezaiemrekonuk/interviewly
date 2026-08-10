/**
 * Issue #148: D01/D02/D03 shipped inert. `questions.candidates` had exactly one writer, and
 * that writer refused to run unless the column was already written — so no row ever got a
 * first pool and `promoteNextQuestion` returned at its gate on every answer of every
 * interview. `chosen_reason` and `candidates` were NULL on all eight rows of a finished run.
 *
 * The acceptance scenarios could not catch it: `adaptive.steps` seeds the pool by hand, which
 * is precisely the step the product had no way to perform. These tests drive the hook with an
 * *unseeded* row, so the producer is on the path under test rather than in the fixture.
 */
import type { Interview, Question } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nextRow = {
  id: 'qst_next',
  text: 'The default next question.',
  difficulty: 'medium',
  topic: 'sql-indexes',
  candidates: null as unknown,
  chosen_reason: null as string | null,
};

const questionUpdate = vi.fn(async () => nextRow);
const answerUpdate = vi.fn(async () => ({}));

vi.mock('../../src/lib/db', () => ({
  prisma: {
    question: {
      update: (args: { data: Record<string, unknown> }) => questionUpdate(args as never),
      findMany: vi.fn(async () => [{ topic: 'sql-indexes' }]),
    },
    answer: { update: (args: unknown) => answerUpdate(args as never) },
    // The promotion's two writes are one transaction in the module; running the array here is
    // enough — what the tests assert is which rows were written, not the isolation level.
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

vi.mock('../ai', () => ({ aiClient: vi.fn() }));

vi.mock('./state', () => ({
  currentQuestionRow: vi.fn(async () => (nextRow.id ? nextRow : null)),
}));

const warn = vi.fn();
vi.mock('../../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: (...args: unknown[]) => warn(...args) },
}));

const { promoteNextQuestion } = await import('./adaptive');

const interview = {
  id: 'itv_1',
  hr_question_count: 2,
  current_index: 5,
  language: 'en',
} as unknown as Interview;

const answered = {
  id: 'qst_answered',
  text: 'How would you index this table?',
  difficulty: 'medium',
  topic: 'sql-indexes',
} as Pick<Question, 'id' | 'text' | 'difficulty' | 'topic'>;

/** The three-tier pool D02's contract promises, in the stub's easier/same/harder order. */
const POOL = [
  { text: 'An easier one.', difficulty: 'easy', topic: 'sql-indexes' },
  { text: 'A same-level one.', difficulty: 'medium', topic: 'sql-indexes' },
  { text: 'A harder one.', difficulty: 'hard', topic: 'query-planning' },
];

function score(overall: number) {
  return { overall, relevance: overall, depth: overall, structure: overall, star_adherence: 0.8, reasons: ['r'] };
}

function clientReturning(overall: number, candidates: unknown = POOL) {
  return {
    scoreAnswer: vi.fn(async () => score(overall)),
    generateCandidates: vi.fn(async () => candidates),
  };
}

/** What `question.update` was asked to write on the next row. */
function writesToNextRow(): Record<string, unknown>[] {
  return questionUpdate.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
}

async function run(client: unknown): Promise<void> {
  await promoteNextQuestion(interview, answered, 'ans_1', 'An answer.', 6, {
    traceId: 'trace-1',
    client: client as never,
  });
}

beforeEach(() => {
  nextRow.id = 'qst_next';
  nextRow.candidates = null;
  nextRow.chosen_reason = null;
  questionUpdate.mockClear();
  answerUpdate.mockClear();
  warn.mockClear();
});

describe('promoteNextQuestion', () => {
  it('generates the pool it promotes from — an unwritten row is no longer a dead end', async () => {
    const client = clientReturning(90);
    await run(client);

    expect(client.generateCandidates).toHaveBeenCalledOnce();
    // @AC-1: the pool is persisted onto the next row, not merely held in memory.
    expect(writesToNextRow()).toContainEqual(expect.objectContaining({ candidates: POOL }));
    // @AC-2: and the same turn records why that row now says what it says.
    expect(writesToNextRow()).toContainEqual(
      expect.objectContaining({ chosen_reason: 'score_high' }),
    );
  });

  it('promotes a different question for a weak answer than for a strong one', async () => {
    await run(clientReturning(20));
    const weak = writesToNextRow().find((d) => 'text' in d);

    questionUpdate.mockClear();
    nextRow.candidates = null;
    await run(clientReturning(90));
    const strong = writesToNextRow().find((d) => 'text' in d);

    // @AC-3. The axis is difficulty: the selector shifts medium down for 0..2 and up for 4..5.
    expect(weak).toMatchObject({ text: 'An easier one.', difficulty: 'easy', chosen_reason: 'score_low' });
    expect(strong).toMatchObject({ text: 'A harder one.', difficulty: 'hard', chosen_reason: 'score_high' });
    expect(weak?.text).not.toEqual(strong?.text);
  });

  it('keeps the default next question askable when pre-generation fails', async () => {
    const client = {
      scoreAnswer: vi.fn(async () => score(5)),
      generateCandidates: vi.fn(async () => {
        throw new Error('provider down');
      }),
    };
    await run(client);

    // @AC-4: a warning, no promotion, and the answer's score still reaches the report — the
    // row keeps the text I06 generated for it, so the interview never blocks on the pool.
    expect(warn).toHaveBeenCalledWith(expect.anything(), 'CANDIDATE_PREGENERATION_FAILED');
    expect(writesToNextRow().some((d) => 'text' in d)).toBe(false);
    expect(answerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { scores: score(5) } }),
    );
  });

  it('reuses a pool the row already carries instead of paying for a second one', async () => {
    nextRow.candidates = POOL;
    const client = clientReturning(60);
    await run(client);

    expect(client.generateCandidates).not.toHaveBeenCalled();
    expect(writesToNextRow()).toContainEqual(
      expect.objectContaining({ text: 'A same-level one.', chosen_reason: 'score_mid' }),
    );
  });

  it('scores and generates concurrently, so the turn waits on one round-trip', async () => {
    const started: string[] = [];
    let releaseScore = (): void => {};
    const client = {
      scoreAnswer: vi.fn(async () => {
        started.push('score');
        await new Promise<void>((resolve) => {
          releaseScore = resolve;
        });
        return score(3);
      }),
      generateCandidates: vi.fn(async () => {
        started.push('generate');
        return POOL;
      }),
    };

    const pending = run(client);
    // A macrotask, not a microtask: pre-generation reads `topicsUsed` before it calls the
    // provider, so `generateCandidates` is a couple of ticks behind the score either way.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Generation ran while the score was still in flight. What this pins is that the pool is
    // *started* before the score is awaited: write the obvious `await prepareNextCandidates()`
    // ahead of the scoring call and `started` is `['generate']`, because scoring has not begun
    // — two serial provider round-trips on the answer response, which no assertion about the
    // finished row would notice. (Awaiting the two in either order after both are in flight is
    // not a regression, and deliberately does not fail here.)
    expect(started).toEqual(['score', 'generate']);
    releaseScore();
    await pending;
  });

  it('never re-scores a row a previous turn already decided', async () => {
    nextRow.chosen_reason = 'score_mid';
    const client = clientReturning(90);
    await run(client);

    expect(client.scoreAnswer).not.toHaveBeenCalled();
    expect(client.generateCandidates).not.toHaveBeenCalled();
  });

  it('spends nothing once the interview has run out of rows to adapt', async () => {
    nextRow.id = '';
    const client = clientReturning(90);
    await run(client);

    expect(client.generateCandidates).not.toHaveBeenCalled();
    expect(client.scoreAnswer).not.toHaveBeenCalled();
  });
});
