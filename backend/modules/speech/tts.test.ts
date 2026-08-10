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
vi.mock('../interview/budget', () => ({
  withBudget: async (_id: string, fn: () => Promise<unknown>) => fn(),
  BudgetExceeded: class extends Error {},
}));
vi.mock('./metering', () => ({ meterTts: vi.fn() }));

import { type Request, type Response } from 'express';

import { ApiError } from '../../src/lib/api-error';

import { isPastSpeechCeiling, serveMessageSpeech, serveQuestionSpeech } from './tts';

const interview = {
  id: 'itv-1',
  user_id: 'u-1',
  mode: 'voice',
  state: 'hr_round',
  current_index: 1,
  hr_question_count: 2,
  language: 'en',
  started_at: new Date('2026-08-06T10:00:00.000Z'),
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
  it('returns false when started_at is missing', () => {
    expect(isPastSpeechCeiling(null)).toBe(false);
  });

  it('returns true at or past min configured ceiling', () => {
    const now = new Date('2026-08-06T10:00:00.000Z');
    m.now.mockReturnValue(now);
    const startedAt = new Date(now.getTime() - 720 * 1000);
    expect(isPastSpeechCeiling(startedAt)).toBe(true);
  });

  // S08: the candidate's choice caps the interview downward only. Anything else would let a
  // request body buy provider time the platform never offered.
  describe('the chosen duration (S08)', () => {
    const now = new Date('2026-08-06T10:00:00.000Z');
    const elapsed = (seconds: number) => new Date(now.getTime() - seconds * 1000);

    beforeEach(() => {
      m.now.mockReturnValue(now);
    });

    it('ends the interview at a chosen duration shorter than the config ceiling', () => {
      expect(isPastSpeechCeiling(elapsed(299), 300)).toBe(false);
      expect(isPastSpeechCeiling(elapsed(300), 300)).toBe(true);
    });

    it('never extends past the config ceiling, however long the choice was', () => {
      expect(isPastSpeechCeiling(elapsed(719), 86_400)).toBe(false);
      expect(isPastSpeechCeiling(elapsed(720), 86_400)).toBe(true);
    });

    it('falls back to the config ceiling when no duration was chosen', () => {
      expect(isPastSpeechCeiling(elapsed(720), null)).toBe(true);
      expect(isPastSpeechCeiling(elapsed(719), null)).toBe(false);
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
    m.now.mockReturnValue(new Date('2026-08-06T10:20:01.000Z'));
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
    m.now.mockReturnValue(new Date('2026-08-06T10:20:01.000Z'));
    m.applyTransition.mockRejectedValue(new ApiError('INVALID_STATE_TRANSITION'));
    const { r } = res();

    await expect(serveQuestionSpeech(req(), r, (() => undefined) as never)).rejects.toMatchObject({
      code: 'VOICE_SESSION_EXPIRED',
    });
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
    m.now.mockReturnValue(new Date('2026-08-06T10:20:01.000Z'));
    const { r } = res();

    await expect(serveMessageSpeech(msgReq(), r, (() => undefined) as never)).rejects.toMatchObject({
      code: 'VOICE_SESSION_EXPIRED',
    });

    expect(m.applyTransition.mock.calls[0]?.[2]?.endedReason).toBe('time_exhausted');
    expect(m.findMessage).not.toHaveBeenCalled();
    expect(m.speak).not.toHaveBeenCalled();
  });
});
