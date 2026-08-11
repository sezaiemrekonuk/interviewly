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

const { orderTranscript, deliverCurrentQuestion, interviewWindow } = await import('./state');
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
 * S09, as I16 left it. The room derives its countdown from these, so they are the same
 * arithmetic `isPastSpeechCeiling` refuses on — 720 is `VOICE_MAX_ROUND_SECONDS`, the lower of
 * the two configured ceilings.
 *
 * The window is now measured from *active* time, so `now` is passed explicitly and every
 * expectation is relative to it rather than to `started_at`. A fixture with no banked seconds
 * and no open stretch is an interview that just began, which is why the first cases still land
 * on the full ceiling.
 */
describe('interviewWindow', () => {
  const started_at = new Date('2026-08-06T10:00:00.000Z');
  const now = started_at;
  const fresh = { started_at, elapsed_seconds: 0, last_seen_at: null };
  const at = (seconds: number) => new Date(now.getTime() + seconds * 1000).toISOString();

  it('expires a voice interview at the configured ceiling', () => {
    expect(interviewWindow({ ...fresh, mode: 'voice', max_duration_seconds: null }, now)).toEqual({
      startedAt: started_at.toISOString(),
      expiresAt: at(720),
      elapsedSeconds: 0,
    });
  });

  it('reports the chosen duration when it is shorter than the ceiling', () => {
    expect(interviewWindow({ ...fresh, mode: 'voice', max_duration_seconds: 300 }, now)).toEqual({
      startedAt: started_at.toISOString(),
      expiresAt: at(300),
      elapsedSeconds: 0,
    });
  });

  it('never reports past the ceiling, however long the choice was', () => {
    expect(
      interviewWindow({ ...fresh, mode: 'voice', max_duration_seconds: 86_400 }, now).expiresAt,
    ).toBe(at(720));
  });

  // The ceiling bounds voice only, and a text interview never reaches the routes that enforce
  // it — an expiry here would be a deadline nothing applies.
  it('reports no expiry for a text interview', () => {
    expect(interviewWindow({ ...fresh, mode: 'text', max_duration_seconds: 300 }, now)).toEqual({
      startedAt: started_at.toISOString(),
      expiresAt: null,
      elapsedSeconds: 0,
    });
  });

  it('reports no start and no expiry before the interview began', () => {
    expect(
      interviewWindow(
        { mode: 'voice', started_at: null, max_duration_seconds: null, elapsed_seconds: 0, last_seen_at: null },
        now,
      ),
    ).toEqual({ startedAt: null, expiresAt: null, elapsedSeconds: 0 });
  });

  // I16 — the ceiling is spent by time in the room, so banked seconds shorten the window and an
  // hour spent away does not. Both interviews below started at the same instant; only the banked
  // figure differs, and only it moves the deadline.
  it('counts the ceiling down from banked active time, not from the start', () => {
    const away = new Date(started_at.getTime() + 3_600 * 1000);
    const window = interviewWindow(
      { mode: 'voice', started_at, max_duration_seconds: null, elapsed_seconds: 180, last_seen_at: null },
      away,
    );
    expect(window.elapsedSeconds).toBe(180);
    // 720 - 180 = 540 seconds left, measured from `away` — the hour out of the room cost nothing.
    expect(window.expiresAt).toBe(new Date(away.getTime() + 540 * 1000).toISOString());
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
