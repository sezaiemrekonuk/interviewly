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

/** The `interview_rounds` rows `resolvePersonas` finds; reassigned per test. */
let roundRows: Array<{ type: 'hr' | 'tech'; persona: Record<string, unknown> }> = [];

vi.mock('../../src/lib/db', () => ({
  prisma: {
    interviewRound: {
      findFirst: vi.fn(async () => ({ id: 'rnd_1' })),
      findMany: vi.fn(async () => roundRows),
    },
    question: { findFirst: vi.fn(async () => row), update: vi.fn(async () => row) },
  },
}));

const seededPersona = vi.fn(async (roundType: 'hr' | 'tech') => ({
  id: `seed-persona-${roundType}`,
  role: roundType,
  name: roundType === 'hr' ? 'Ada' : 'Turing',
  avatar_set: { idle: `${roundType}/idle.webp` },
}));
vi.mock('./generation', () => ({ seededPersona: (t: 'hr' | 'tech') => seededPersona(t) }));

const info = vi.fn();
vi.mock('../../src/lib/logger', () => ({ logger: { info: (...a: unknown[]) => info(...a) } }));

const peek = vi.fn();
const take = vi.fn();
vi.mock('../speech/pending-turn', () => ({ peekPendingTurn: peek, takePendingTurn: take }));

/** The live tile's expression is a Redis read; `avatar.test.ts` owns it. Here it is just a value. */
vi.mock('./avatar', () => ({ currentAvatar: vi.fn(async () => 2) }));

const { orderTranscript, deliverCurrentQuestion, interviewWindow, resolvePersonas, __testing } =
  await import('./state');
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
 * S09, as I16 left it. The room derives its countdown from these, so they are the same
 * arithmetic `isPastSpeechCeiling` refuses on — 1800 is both configured ceilings, which now
 * hold the same 30 minutes.
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
      expiresAt: at(1800),
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
    ).toBe(at(1800));
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
    // 1800 - 180 = 1620 seconds left, measured from `away` — the hour out of the room cost nothing.
    expect(window.expiresAt).toBe(new Date(away.getTime() + 1620 * 1000).toISOString());
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

/**
 * Issue 129 — the roster is the interview's round shape, not the `interview_rounds` rows that
 * happen to exist yet. The technical row is written with its batch, so deriving the roster from
 * rows made the room's tile count a side effect of question generation: one tile for the whole
 * HR round, and a second interviewer appearing mid-interview.
 */
describe('resolvePersonas', () => {
  const generated = (type: 'hr' | 'tech') => ({
    type,
    persona: {
      id: `assigned-${type}`,
      role: type,
      name: type === 'hr' ? 'Ada' : 'Turing',
      avatar_set: { idle: `${type}/idle.webp` },
    },
  });

  const interview = {
    id: 'itv_1',
    state: 'hr_round',
    hr_question_count: 3,
    target_question_count: 8,
  };

  beforeEach(() => {
    roundRows = [];
    seededPersona.mockClear();
  });

  it('rosters both interviewers while only the HR round row exists', async () => {
    roundRows = [generated('hr')];

    const { personas } = await resolvePersonas(interview);

    expect(personas.map((p) => p.roundType)).toEqual(['hr', 'tech']);
    // The generated row wins where there is one; the seeded lookup fills only the round whose
    // batch has not been written, and it is the same lookup `generation.ts` will use for it.
    expect(personas.map((p) => p.id)).toEqual(['assigned-hr', 'seed-persona-tech']);
    expect(seededPersona).toHaveBeenCalledExactlyOnceWith('tech');
  });

  it('does not change the tile count at the handover', async () => {
    roundRows = [generated('hr')];
    const before = await resolvePersonas(interview);

    roundRows = [generated('hr'), generated('tech')];
    const after = await resolvePersonas({ ...interview, state: 'tech_round' });

    expect(after.personas).toHaveLength(before.personas.length);
    expect(after.personas.map((p) => p.roundType)).toEqual(['hr', 'tech']);
  });

  it('promises no technical interviewer when the split leaves that round empty', async () => {
    roundRows = [generated('hr')];

    // `target 2 → hr 2, tech 0` — a legal interview that ends straight out of the HR round.
    const { personas } = await resolvePersonas({
      ...interview,
      hr_question_count: 2,
      target_question_count: 2,
    });

    expect(personas.map((p) => p.roundType)).toEqual(['hr']);
    expect(seededPersona).not.toHaveBeenCalled();
  });

  it('lights exactly one tile — the round the interview is in', async () => {
    roundRows = [generated('hr')];

    const inHr = await resolvePersonas(interview);
    const inTech = await resolvePersonas({ ...interview, state: 'tech_round' });
    const ended = await resolvePersonas({ ...interview, state: 'evaluating' });

    // The live tile carries the expression it is currently showing; the dark one carries none.
    expect(inHr.persona).toMatchObject({ id: 'assigned-hr', avatar: 2 });
    expect(inTech.persona).toMatchObject({ id: 'seed-persona-tech' });
    expect(ended.persona).toBeNull();
  });
});
