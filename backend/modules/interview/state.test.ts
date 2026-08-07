/**
 * `order_index` is per-round, so a raw findMany interleaves the two rounds: the room would show
 * technical turn 1 above HR turn 3. The global order (K2) is HR round first, then technical.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const row = {
  id: 'qst_1',
  text: 'Why an index?',
  kind: 'open',
  difficulty: 'hard',
  topic: 'sql-indexes',
  chosen_reason: 'score_high',
  asked_at: null as Date | null,
};

vi.mock('../../src/lib/db', () => ({
  prisma: {
    interviewRound: { findFirst: vi.fn(async () => ({ id: 'rnd_1' })) },
    question: { findFirst: vi.fn(async () => row), update: vi.fn(async () => row) },
  },
}));

const info = vi.fn();
vi.mock('../../src/lib/logger', () => ({ logger: { info: (...a: unknown[]) => info(...a) } }));

const { orderTranscript, deliverCurrentQuestion } = await import('./state');
type TranscriptQuestion = Parameters<typeof orderTranscript>[0][number];

const question = (
  id: string,
  order_index: number,
  type: 'hr' | 'tech',
  answer?: string,
): TranscriptQuestion => ({
  id,
  text: `${id}?`,
  order_index,
  round: { type },
  answers: answer ? [{ transcript: answer, answered_at: new Date() }] : [],
});

describe('deliverCurrentQuestion', () => {
  beforeEach(() => {
    info.mockClear();
    row.asked_at = null;
  });

  const interview = { id: 'itv_1', hr_question_count: 2, current_index: 1 };

  it('logs the delivered difficulty under QUESTION_DIFFICULTY_DELIVERED', async () => {
    await deliverCurrentQuestion(interview);

    expect(info).toHaveBeenCalledTimes(1);
    const [fields, title] = info.mock.calls[0];
    expect(title).toBe('QUESTION_DIFFICULTY_DELIVERED');
    expect(fields).toMatchObject({
      interviewId: 'itv_1',
      questionId: 'qst_1',
      difficulty: 'hard',
      chosenReason: 'score_high',
    });
  });

  it('does not log again when a refetch re-delivers an already asked question', async () => {
    row.asked_at = new Date('2026-08-07T10:00:00Z');

    await deliverCurrentQuestion(interview);

    expect(info).not.toHaveBeenCalled();
  });
});

describe('orderTranscript', () => {
  it('orders HR turns before technical ones, by order_index within a round', () => {
    const rows = [
      question('t1', 1, 'tech', 'tech one'),
      question('h2', 2, 'hr', 'hr two'),
      question('h1', 1, 'hr', 'hr one'),
    ];

    expect(orderTranscript(rows).map((turn) => turn.answer)).toEqual([
      'hr one',
      'hr two',
      'tech one',
    ]);
  });

  it('drops questions with no answer — the transcript is answered turns only', () => {
    const rows = [question('h1', 1, 'hr', 'hr one'), question('h2', 2, 'hr')];

    expect(orderTranscript(rows)).toEqual([
      { questionId: 'h1', question: 'h1?', answer: 'hr one', roundType: 'hr' },
    ]);
  });
});
