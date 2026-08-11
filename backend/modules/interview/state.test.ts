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

const peek = vi.fn();
const take = vi.fn();
vi.mock('../speech/pending-turn', () => ({ peekPendingTurn: peek, takePendingTurn: take }));

const { orderTranscript, deliverCurrentQuestion, interviewWindow, __testing } = await import(
  './state'
);
const { pendingTurnFor, messagesWhere } = __testing;
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

/**
 * S09. The room derives its countdown from these two, so they are the same arithmetic
 * `isPastSpeechCeiling` refuses on — 720 is `VOICE_MAX_ROUND_SECONDS`, the lower of the two
 * configured ceilings.
 */
describe('interviewWindow', () => {
  const started_at = new Date('2026-08-06T10:00:00.000Z');
  const at = (seconds: number) => new Date(started_at.getTime() + seconds * 1000).toISOString();

  it('expires a voice interview at the configured ceiling', () => {
    expect(interviewWindow({ mode: 'voice', started_at, max_duration_seconds: null })).toEqual({
      startedAt: started_at.toISOString(),
      expiresAt: at(720),
    });
  });

  it('reports the chosen duration when it is shorter than the ceiling', () => {
    expect(interviewWindow({ mode: 'voice', started_at, max_duration_seconds: 300 })).toEqual({
      startedAt: started_at.toISOString(),
      expiresAt: at(300),
    });
  });

  it('never reports past the ceiling, however long the choice was', () => {
    expect(
      interviewWindow({ mode: 'voice', started_at, max_duration_seconds: 86_400 }).expiresAt,
    ).toBe(at(720));
  });

  // The ceiling bounds voice only, and a text interview never reaches the routes that enforce
  // it — an expiry here would be a deadline nothing applies.
  it('reports no expiry for a text interview', () => {
    expect(interviewWindow({ mode: 'text', started_at, max_duration_seconds: 300 })).toEqual({
      startedAt: started_at.toISOString(),
      expiresAt: null,
    });
  });

  it('reports neither field before the interview started', () => {
    expect(
      interviewWindow({ mode: 'voice', started_at: null, max_duration_seconds: null }),
    ).toEqual({ startedAt: null, expiresAt: null });
  });
});

/**
 * T03 — the held partial on `/state`, which is how a room rebuilt after a reload knows the
 * candidate was mid-thought (@AC-7, @AC-6).
 */
describe('pendingTurnFor', () => {
  const question = { id: 'qst_1' } as never;

  beforeEach(() => {
    peek.mockReset();
    take.mockReset();
  });

  it('surfaces the partial held against the current question', async () => {
    peek.mockResolvedValue({ text: 'So at my last company we', questionId: 'qst_1', probes: 1 });

    expect(await pendingTurnFor('itv_1', question)).toBe('So at my last company we');
  });

  // A thought aimed at a question the interview has left is not an answer to the one it is on,
  // and showing it in the room would invite the candidate to finish the wrong sentence.
  it('reports nothing for a partial from a past question', async () => {
    peek.mockResolvedValue({ text: 'about the deadline', questionId: 'qst_0', probes: 1 });

    expect(await pendingTurnFor('itv_1', question)).toBeNull();
    expect(await pendingTurnFor('itv_1', null)).toBeNull();
  });

  // The defect this pins: a state read that consumed would delete the candidate's own sentence
  // the first time the room refetched, and the room refetches on every render.
  it('never consumes — two consecutive reads return the same text', async () => {
    peek.mockResolvedValue({ text: 'and then we', questionId: 'qst_1', probes: 2 });

    expect(await pendingTurnFor('itv_1', question)).toBe('and then we');
    expect(await pendingTurnFor('itv_1', question)).toBe('and then we');
    expect(take).not.toHaveBeenCalled();
  });
});

/**
 * The filter's `action: null` branch is load-bearing and invisible: `notIn` compiles to SQL that
 * is NULL — and so excludes the row — wherever `action` is null, which is every candidate turn.
 * Widening it without the branch deletes the entire candidate side of the room, and the response
 * still has a `messages` array. The SQL half is pinned in `state.integration.test.ts`.
 */
describe('messagesWhere', () => {
  it('hides the two server notes while keeping every candidate row', () => {
    expect(messagesWhere('itv_1')).toEqual({
      interview_id: 'itv_1',
      OR: [{ action: null }, { action: { notIn: ['refused', 'silence'] } }],
    });
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
