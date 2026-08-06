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
  loggerInfo: vi.fn(),
  now: vi.fn(() => new Date('2026-08-06T10:10:00.000Z')),
}));

vi.mock('../../src/lib/clock', () => ({ clock: { now: m.now } }));
vi.mock('../../src/lib/env', () => ({
  config: { VOICE_MAX_ROUND_SECONDS: 720, VOICE_MAX_INTERVIEW_SECONDS: 1500 },
}));
vi.mock('../../src/lib/db', () => ({
  activeInterview: m.activeInterview,
  prisma: { interviewRound: { findFirstOrThrow: m.findRound } },
}));
vi.mock('../interview/state', () => ({ currentQuestionRow: m.currentQuestion }));
vi.mock('../interview/machine', () => ({ applyTransition: m.applyTransition }));
vi.mock('../../src/lib/storage', () => ({ storage: { get: m.storageGet, put: m.storagePut } }));
vi.mock('./SpeechProvider', () => ({ speechProvider: { speak: m.speak } }));
vi.mock('../voice/downgrade', () => ({ downgradeToText: m.downgrade }));
vi.mock('../../src/lib/logger', () => ({ logger: { info: m.loggerInfo } }));

import { type Request, type Response } from 'express';

import { isPastSpeechCeiling, serveQuestionSpeech } from './tts';

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

function req(): Request {
  return {
    params: { id: interview.id, index: '1' },
    user: { id: interview.user_id },
    traceId: 'trace-1',
  } as unknown as Request;
}

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
});
