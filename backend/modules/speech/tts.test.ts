import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  speak: vi.fn(),
  storageGet: vi.fn(),
  storagePut: vi.fn(),
  applyTransition: vi.fn(),
  downgrade: vi.fn(),
  currentQuestion: vi.fn(),
  activeInterview: vi.fn(),
  findRound: vi.fn(),
  findMessage: vi.fn(),
  findQuestion: vi.fn(),
  meterTts: vi.fn(),
  loggerInfo: vi.fn(),
  now: vi.fn(() => new Date('2026-08-06T10:10:00.000Z')),
}));

vi.mock('../../src/lib/clock', () => ({ clock: { now: m.now } }));
vi.mock('../../src/lib/env', () => ({
  config: { VOICE_MAX_ROUND_SECONDS: 720, VOICE_MAX_INTERVIEW_SECONDS: 1500 },
}));
vi.mock('../../src/lib/db', () => ({
  activeInterview: m.activeInterview,
  prisma: {
    interviewRound: { findFirstOrThrow: m.findRound },
    chatMessage: { findUnique: m.findMessage },
    question: { findUnique: m.findQuestion },
  },
}));
vi.mock('../interview/state', () => ({ currentQuestionRow: m.currentQuestion }));
vi.mock('../interview/machine', () => ({ applyTransition: m.applyTransition }));
vi.mock('../../src/lib/storage', () => ({ storage: { get: m.storageGet, put: m.storagePut } }));
vi.mock('./SpeechProvider', () => ({ speechProvider: { speak: m.speak } }));
vi.mock('../voice/downgrade', () => ({ downgradeToText: m.downgrade }));
vi.mock('../../src/lib/logger', () => ({ logger: { info: m.loggerInfo, error: vi.fn(), warn: vi.fn() } }));
vi.mock('../interview/budget', () => {
  // The real ceiling serialises one interview's generations under an advisory lock. The double
  // -bill test below depends on that: without serialisation the second `synthesise` re-reads the
  // cache before the first has written it, and the re-read this test exists to prove would be a
  // no-op. A chained promise is the smallest faithful stand-in.
  let chain = Promise.resolve();
  return {
    withBudget: (_id: string, fn: () => Promise<unknown>) => {
      const run = chain.then(() => fn());
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    BudgetExceeded: class extends Error {},
  };
});
vi.mock('./metering', () => ({ meterTts: m.meterTts }));

import { type Request, type Response } from 'express';

import { ApiError } from '../../src/lib/api-error';

import { isPastSpeechCeiling, prewarmMessageSpeech, serveMessageSpeech, serveQuestionSpeech, synthesise } from './tts';

const interview = {
  id: 'itv-1',
  user_id: 'u-1',
  mode: 'voice',
  state: 'hr_round',
  current_index: 1,
  hr_question_count: 2,
  language: 'en',
  started_at: new Date('2026-08-06T10:00:00.000Z'),
  // I16 — the ceiling reads these, not `started_at`. A test that wants the interview to be out
  // of time raises `elapsed_seconds`; advancing `m.now` no longer does it, because time outside
  // the room is not time the interview spent.
  elapsed_seconds: 0,
  last_seen_at: null as Date | null,
  max_duration_seconds: null as number | null,
  ended_reason: null,
};

function req(params: Record<string, string> = { index: '1' }): Request {
  return {
    params: { id: interview.id, ...params },
    user: { id: interview.user_id },
    traceId: 'trace-1',
  } as unknown as Request;
}

const msgReq = () => req({ messageId: 'm1' });

function res() {
  const out: { status?: number; mime?: string; body?: Buffer } = {};
  const r = {
    status(code: number) {
      out.status = code;
      return r;
    },
    type(mime: string) {
      out.mime = mime;
      return r;
    },
    send(body: Buffer) {
      out.body = body;
      return r;
    },
  } as unknown as Response;
  return { r, out };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.now.mockReturnValue(new Date('2026-08-06T10:10:00.000Z'));
  m.activeInterview.mockResolvedValue({ ...interview });
  m.currentQuestion.mockResolvedValue({ id: 'q-1', text: 'Tell me about yourself.' });
  m.findRound.mockResolvedValue({ persona: { voice_id: 'voice-hr' } });
  m.findMessage.mockResolvedValue({
    id: 'm1',
    interview_id: interview.id,
    role: 'assistant',
    content: 'Welcome — shall we start?',
    question_id: null,
  });
  m.findQuestion.mockResolvedValue({ round: { persona: { voice_id: 'voice-tech' } } });
  m.storageGet.mockResolvedValue(Buffer.from([0xff, 0xfb, 0x90, 0x00]));
  m.storagePut.mockResolvedValue(undefined);
  m.speak.mockResolvedValue({ audio: Buffer.from([1, 2, 3]), mime: 'audio/mpeg', characters: 24 });
  m.applyTransition.mockImplementation(async (row: { ended_reason: string | null }, _to: string, ctx: { endedReason?: string }) => {
    row.ended_reason = ctx.endedReason ?? null;
    return 'evaluating';
  });
  m.downgrade.mockResolvedValue(true);
});

afterEach(() => {
  m.now.mockReset();
});

describe('isPastSpeechCeiling', () => {
  const now = new Date('2026-08-06T10:00:00.000Z');
  const startedAt = new Date(now.getTime() - 86_400 * 1000);

  /**
   * I16 — the ceiling is spent by active time, so a fixture states its elapsed figure directly
   * instead of backdating `started_at`. `started_at` is a day earlier in every case below to
   * make the point: how long ago the interview began no longer decides anything.
   */
  const spent = (seconds: number, max_duration_seconds: number | null = null) => ({
    started_at: startedAt,
    elapsed_seconds: seconds,
    last_seen_at: null,
    max_duration_seconds,
  });

  beforeEach(() => {
    m.now.mockReturnValue(now);
  });

  it('returns false when started_at is missing', () => {
    expect(isPastSpeechCeiling({ ...spent(86_400), started_at: null })).toBe(false);
  });

  it('returns true at or past min configured ceiling', () => {
    expect(isPastSpeechCeiling(spent(720))).toBe(true);
  });

  it('ignores time spent out of the room, however long the interview has existed', () => {
    // A day since it started and only three minutes of it in the room: nowhere near the ceiling.
    expect(isPastSpeechCeiling(spent(180))).toBe(false);
  });

  it('counts the stretch since the last heartbeat, but only inside the grace window', () => {
    const beating = { ...spent(719), last_seen_at: new Date(now.getTime() - 5_000) };
    expect(isPastSpeechCeiling(beating)).toBe(true);

    // The same 719 banked seconds, but the last beat was minutes ago — the candidate is not in
    // the room, that gap is not theirs to have spent, and the interview still has a second left.
    const gone = { ...spent(719), last_seen_at: new Date(now.getTime() - 600_000) };
    expect(isPastSpeechCeiling(gone)).toBe(false);
  });

  // S08: the candidate's choice caps the interview downward only. Anything else would let a
  // request body buy provider time the platform never offered.
  describe('the chosen duration (S08)', () => {
    it('ends the interview at a chosen duration shorter than the config ceiling', () => {
      expect(isPastSpeechCeiling(spent(299, 300))).toBe(false);
      expect(isPastSpeechCeiling(spent(300, 300))).toBe(true);
    });

    it('never extends past the config ceiling, however long the choice was', () => {
      expect(isPastSpeechCeiling(spent(719, 86_400))).toBe(false);
      expect(isPastSpeechCeiling(spent(720, 86_400))).toBe(true);
    });

    it('falls back to the config ceiling when no duration was chosen', () => {
      expect(isPastSpeechCeiling(spent(720, null))).toBe(true);
      expect(isPastSpeechCeiling(spent(719, null))).toBe(false);
    });
  });
});

describe('serveQuestionSpeech', () => {
  it('serves cache hit and provider call count stays zero', async () => {
    const { r, out } = res();

    await serveQuestionSpeech(req(), r, (() => undefined) as never);

    expect(m.storageGet).toHaveBeenCalledOnce();
    expect(m.speak).not.toHaveBeenCalled();
    expect(out.status).toBe(200);
    expect(out.mime).toBe('audio/mpeg');
  });

  it('past ceiling ends interview with time_exhausted and never calls provider', async () => {
    m.activeInterview.mockResolvedValue({ ...interview, elapsed_seconds: 721 });
    const { r } = res();

    await expect(serveQuestionSpeech(req(), r, (() => undefined) as never)).rejects.toMatchObject({
      code: 'VOICE_SESSION_EXPIRED',
    });

    expect(m.applyTransition).toHaveBeenCalledOnce();
    expect(m.applyTransition.mock.calls[0]?.[2]?.endedReason).toBe('time_exhausted');
    expect(m.speak).not.toHaveBeenCalled();
    expect(m.storageGet).not.toHaveBeenCalled();
  });

  it('a losing ceiling transition still surfaces VOICE_SESSION_EXPIRED (ADR-I32)', async () => {
    m.activeInterview.mockResolvedValue({ ...interview, elapsed_seconds: 721 });
    m.applyTransition.mockRejectedValue(new ApiError('INVALID_STATE_TRANSITION'));
    const { r } = res();

    await expect(serveQuestionSpeech(req(), r, (() => undefined) as never)).rejects.toMatchObject({
      code: 'VOICE_SESSION_EXPIRED',
    });
  });

  it('a fatal speech error downgrades to text before the 503 reaches the caller', async () => {
    m.storageGet.mockRejectedValue(new Error('miss'));
    m.speak.mockRejectedValue(new ApiError('VOICE_UNAVAILABLE'));
    let written = false;
    m.downgrade.mockImplementation(async () => {
      await Promise.resolve();
      written = true;
      return true;
    });
    const { r } = res();

    await expect(serveQuestionSpeech(req(), r, (() => undefined) as never)).rejects.toMatchObject({
      code: 'VOICE_UNAVAILABLE',
    });

    expect(m.downgrade).toHaveBeenCalledOnce();
    expect(m.downgrade.mock.calls[0]?.[0]).toMatchObject({ id: 'itv-1' });
    expect(m.downgrade.mock.calls[0]?.[1]).toEqual({ traceId: 'trace-1' });
    expect(written).toBe(true);
  });
});

/** C06 — the lines that are not questions: the welcome, clarifications, handover, goodbye. */
describe('serveMessageSpeech', () => {
  it('serves an assistant line from its own cache key, provider untouched', async () => {
    const { r, out } = res();

    await serveMessageSpeech(msgReq(), r, (() => undefined) as never);

    expect(m.storageGet).toHaveBeenCalledWith('speech/msg-m1.mp3');
    expect(m.speak).not.toHaveBeenCalled();
    expect(out.status).toBe(200);
    expect(out.mime).toBe('audio/mpeg');
  });

  it('refuses to speak anything the interviewer did not say', async () => {
    for (const role of ['user', 'system']) {
      m.findMessage.mockResolvedValue({
        id: 'm1',
        interview_id: interview.id,
        role,
        content: 'not the interviewer',
        question_id: null,
      });
      const { r } = res();

      await expect(serveMessageSpeech(msgReq(), r, (() => undefined) as never)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    }
    expect(m.speak).not.toHaveBeenCalled();
  });

  it("another interview's message id is a 404, not a leak", async () => {
    m.findMessage.mockResolvedValue({
      id: 'm1',
      interview_id: 'itv-someone-else',
      role: 'assistant',
      content: 'their welcome',
      question_id: null,
    });
    const { r } = res();

    await expect(serveMessageSpeech(msgReq(), r, (() => undefined) as never)).rejects.toMatchObject({
      code: 'INTERVIEW_NOT_FOUND',
    });
  });

  // The refresh case: the room replays what it missed, so a line the index has moved past is
  // still served — and still in the voice of the round that said it, not the current one.
  it('replays a past line in its own round\'s voice', async () => {
    m.activeInterview.mockResolvedValue({ ...interview, state: 'tech_round', current_index: 5 });
    m.findMessage.mockResolvedValue({
      id: 'm1',
      interview_id: interview.id,
      role: 'assistant',
      content: 'And what did you learn from it?',
      question_id: 'q-hr-2',
    });
    m.findQuestion.mockResolvedValue({ round: { persona: { voice_id: 'voice-hr' } } });
    m.storageGet.mockRejectedValue(new Error('miss'));
    const { r, out } = res();

    await serveMessageSpeech(msgReq(), r, (() => undefined) as never);

    expect(m.speak.mock.calls[0]?.[1]?.voiceId).toBe('voice-hr');
    expect(m.findRound).not.toHaveBeenCalled();
    expect(out.status).toBe(200);
  });

  it('falls back to the current round when the line belongs to no question', async () => {
    m.storageGet.mockRejectedValue(new Error('miss'));
    const { r } = res();

    await serveMessageSpeech(msgReq(), r, (() => undefined) as never);

    expect(m.findQuestion).not.toHaveBeenCalled();
    expect(m.findRound.mock.calls[0]?.[0]?.where?.type).toBe('hr');
    expect(m.speak.mock.calls[0]?.[1]?.voiceId).toBe('voice-hr');
  });

  it('past the ceiling nothing is spoken and the interview ends', async () => {
    m.activeInterview.mockResolvedValue({ ...interview, elapsed_seconds: 721 });
    const { r } = res();

    await expect(serveMessageSpeech(msgReq(), r, (() => undefined) as never)).rejects.toMatchObject({
      code: 'VOICE_SESSION_EXPIRED',
    });

    expect(m.applyTransition.mock.calls[0]?.[2]?.endedReason).toBe('time_exhausted');
    expect(m.findMessage).not.toHaveBeenCalled();
    expect(m.speak).not.toHaveBeenCalled();
  });
});

/**
 * L02 — the paid half of a route, split out so the eager prewarm and the client's own GET share
 * it. The one thing that must survive the split is the double-checked read under the budget lock.
 */
describe('synthesise', () => {
  it('two concurrent synthesises of one line bill exactly once', async () => {
    // The store misses until the first synthesis writes it, then hits — the shape of two first
    // requests for the same line racing through the lock.
    let stored: Buffer | null = null;
    m.storageGet.mockImplementation(async () => {
      if (stored) return stored;
      throw new Error('miss');
    });
    m.storagePut.mockImplementation(async (_key: string, buf: Buffer) => {
      stored = buf;
    });
    m.speak.mockResolvedValue({ audio: Buffer.from([9, 9]), mime: 'audio/mpeg', characters: 24 });

    const spec = {
      key: 'speech/msg-m1.mp3',
      text: 'Welcome.',
      voiceId: async () => 'voice-hr',
      traceId: 'trace-1',
      log: { messageId: 'm1' },
    };
    const arg = { ...interview } as unknown as Parameters<typeof synthesise>[0];
    const [a, b] = await Promise.all([synthesise(arg, spec), synthesise(arg, spec)]);

    expect(m.speak).toHaveBeenCalledOnce();
    expect(m.meterTts).toHaveBeenCalledOnce();
    expect(a.audio).toEqual(b.audio);
    // One served freshly billed bytes, the other the re-read cache — never a second charge.
    expect([a.cached, b.cached].sort()).toEqual([false, true]);
  });
});

/** L02 — synthesis begun when the row is written. Off the turn, so it must never block or fail it. */
describe('prewarmMessageSpeech', () => {
  it('synthesises the line off the request that will serve it', async () => {
    m.storageGet.mockRejectedValue(new Error('miss'));
    m.speak.mockResolvedValue({ audio: Buffer.from([1]), mime: 'audio/mpeg', characters: 12 });

    await prewarmMessageSpeech('itv-1', 'm1', 'trace-1');

    expect(m.speak).toHaveBeenCalledOnce();
    expect(m.meterTts).toHaveBeenCalledOnce();
  });

  it('never rejects when synthesis fails — the room GET is what reports failure', async () => {
    m.storageGet.mockRejectedValue(new Error('miss'));
    m.speak.mockRejectedValue(new Error('provider down'));

    await expect(prewarmMessageSpeech('itv-1', 'm1', 'trace-1')).resolves.toBeUndefined();
  });

  it("does not spend past the ceiling, and does not end the interview — that is the GET's job", async () => {
    m.activeInterview.mockResolvedValue({ ...interview, elapsed_seconds: 721 });

    await prewarmMessageSpeech('itv-1', 'm1', 'trace-1');

    expect(m.findMessage).not.toHaveBeenCalled();
    expect(m.speak).not.toHaveBeenCalled();
    expect(m.applyTransition).not.toHaveBeenCalled();
  });

  it('speaks nothing for a text interview', async () => {
    m.activeInterview.mockResolvedValue({ ...interview, mode: 'text' });

    await prewarmMessageSpeech('itv-1', 'm1', 'trace-1');

    expect(m.speak).not.toHaveBeenCalled();
  });
});
