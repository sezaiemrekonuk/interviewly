/**
 * S04 — per-call usage accounting. Proves the two things a green happy-path test cannot:
 * a provider error bills nothing, and an interview already at its budget never calls the
 * provider. The metering shape (character vs second, one row per call) is asserted directly
 * on `meterTts`/`meterStt`; the route tests use the REAL meter with a mocked `recordLlmCall`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  recordLlmCall: vi.fn(),
  activeInterview: vi.fn(),
  findRound: vi.fn(),
  currentQuestion: vi.fn(),
  applyTransition: vi.fn(),
  speak: vi.fn(),
  transcribe: vi.fn(),
  advance: vi.fn(),
  storageGet: vi.fn(),
  storagePut: vi.fn(),
  downgrade: vi.fn(),
  withBudget: vi.fn(),
  BudgetExceeded: class extends Error {},
  loggerWarn: vi.fn(),
  now: vi.fn(() => new Date('2026-08-06T10:10:00.000Z')),
}));

vi.mock('../../src/lib/clock', () => ({ clock: { now: m.now } }));
vi.mock('../../src/lib/env', () => ({
  config: { VOICE_MAX_ROUND_SECONDS: 720, VOICE_MAX_INTERVIEW_SECONDS: 1500 },
}));
vi.mock('../../src/lib/db', () => ({
  activeInterview: m.activeInterview,
  recordLlmCall: m.recordLlmCall,
  prisma: { interviewRound: { findFirstOrThrow: m.findRound } },
}));
vi.mock('../interview/state', () => ({ currentQuestionRow: m.currentQuestion }));
vi.mock('../interview/machine', () => ({ applyTransition: m.applyTransition }));
vi.mock('../../src/lib/storage', () => ({ storage: { get: m.storageGet, put: m.storagePut } }));
vi.mock('./SpeechProvider', () => ({ speechProvider: { speak: m.speak, transcribe: m.transcribe } }));
vi.mock('../voice/downgrade', () => ({ downgradeToText: m.downgrade }));
vi.mock('../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: m.loggerWarn, error: vi.fn() } }));
vi.mock('../interview/budget', () => ({ withBudget: m.withBudget, BudgetExceeded: m.BudgetExceeded }));
vi.mock('../interview/adaptive', () => ({ promoteNextQuestion: vi.fn() }));
vi.mock('../interview/generation', () => ({ ensureTechBatch: vi.fn() }));
vi.mock('../interview/language', () => ({ trackLanguage: vi.fn() }));
vi.mock('../interview/answers', async (orig) => {
  const actual = await orig<typeof import('../interview/answers')>();
  return { answerInputSchema: actual.answerInputSchema, advanceWithAnswer: m.advance };
});

import { type Request, type Response } from 'express';

import { ApiError } from '../../src/lib/api-error';

import { meterStt, meterTts } from './metering';
import { submitAnswerAudio } from './stt';
import { serveQuestionSpeech } from './tts';

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

function ttsReq(): Request {
  return {
    params: { id: interview.id, index: '1' },
    user: { id: interview.user_id },
    traceId: 'trace-1',
  } as unknown as Request;
}

function ttsRes() {
  const r = {
    status: () => r,
    type: () => r,
    send: () => r,
  } as unknown as Response;
  return r;
}

function sttReq(): Request {
  return {
    params: { id: interview.id },
    user: { id: interview.user_id },
    traceId: 'trace-1',
    body: { questionId: 'q-1' },
    file: { buffer: Buffer.from([1, 2, 3, 4]), size: 4, mimetype: 'audio/webm' },
  } as unknown as Request;
}

function sttRes() {
  const out: { body?: unknown } = {};
  const r = {
    locals: { interview: { ...interview } },
    status: () => r,
    json: (body: unknown) => {
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
  m.storageGet.mockRejectedValue(new Error('cache miss'));
  m.storagePut.mockResolvedValue(undefined);
  m.speak.mockResolvedValue({
    audio: Buffer.from([1, 2, 3]),
    mime: 'audio/mpeg',
    characters: 24,
    provider: 'elevenlabs',
    model: 'eleven_turbo_v2_5',
  });
  m.transcribe.mockResolvedValue({
    transcript: 'A spoken answer.',
    seconds: 12,
    provider: 'elevenlabs',
    model: 'scribe_v1',
  });
  m.advance.mockResolvedValue({ state: 'hr_round', nextIndex: 2 });
  m.withBudget.mockImplementation(async (_id: string, fn: () => Promise<unknown>) => fn());
  m.applyTransition.mockImplementation(
    async (row: { ended_reason: string | null }, _to: string, ctx: { endedReason?: string }) => {
      row.ended_reason = ctx.endedReason ?? null;
      return 'evaluating';
    },
  );
});

const liveTts = { provider: 'elevenlabs', model: 'eleven_turbo_v2_5', latencyMs: 430 };
const liveStt = { provider: 'elevenlabs', model: 'scribe_v1', latencyMs: 1650 };

describe('meterTts', () => {
  it('writes one character-metered elevenlabs row with the model id the call used and the price-file cost', async () => {
    await meterTts('itv-1', 100, liveTts, 'trace-1');

    expect(m.recordLlmCall).toHaveBeenCalledOnce();
    expect(m.recordLlmCall.mock.calls[0]?.[0]).toMatchObject({
      interview_id: 'itv-1',
      provider: 'elevenlabs',
      model: 'eleven_turbo_v2_5',
      unit_kind: 'character',
      units: 100,
      cost_usd: 0.018, // 100 / 1e6 * 180.00
      prompt_uuid: '',
      prompt_version: 0,
      attempt_no: 1,
      latency_ms: 430,
      trace_id: 'trace-1',
    });
    expect(m.loggerWarn).not.toHaveBeenCalled();
  });

  it('bills nothing for a provider the price file does not name', async () => {
    await meterTts('itv-1', 100, { provider: 'fake', model: 'fake', latencyMs: 3 }, 'trace-1');

    expect(m.recordLlmCall.mock.calls[0]?.[0]).toMatchObject({
      provider: 'fake',
      model: 'fake',
      units: 100,
      cost_usd: 0,
    });
    expect(m.loggerWarn.mock.calls.at(-1)?.[1]).toBe('PRICE_MISSING');
  });
});

describe('meterStt', () => {
  it('writes one second-metered elevenlabs row with the model id the call used and the price-file cost', async () => {
    await meterStt('itv-1', 60, liveStt, 'trace-1');

    expect(m.recordLlmCall).toHaveBeenCalledOnce();
    expect(m.recordLlmCall.mock.calls[0]?.[0]).toMatchObject({
      interview_id: 'itv-1',
      provider: 'elevenlabs',
      model: 'scribe_v1',
      unit_kind: 'second',
      units: 60,
      cost_usd: 0.006667, // 60 * 0.006667 / 60
      latency_ms: 1650,
    });
    expect(m.loggerWarn).not.toHaveBeenCalled();
  });

  it('bills nothing for a provider the price file does not name', async () => {
    await meterStt('itv-1', 60, { provider: 'fake', model: 'fake', latencyMs: 3 }, 'trace-1');

    expect(m.recordLlmCall.mock.calls[0]?.[0]).toMatchObject({
      provider: 'fake',
      model: 'fake',
      units: 60,
      cost_usd: 0,
    });
    expect(m.loggerWarn.mock.calls.at(-1)?.[1]).toBe('PRICE_MISSING');
  });
});

describe('serveQuestionSpeech metering', () => {
  it('a successful call records exactly one character row', async () => {
    await serveQuestionSpeech(ttsReq(), ttsRes(), (() => undefined) as never);

    expect(m.speak).toHaveBeenCalledOnce();
    expect(m.recordLlmCall).toHaveBeenCalledOnce();
    expect(m.recordLlmCall.mock.calls[0]?.[0]).toMatchObject({
      model: 'eleven_turbo_v2_5',
      unit_kind: 'character',
      units: 24,
    });
  });

  it('stores how long the provider call actually took', async () => {
    vi.useFakeTimers();
    m.speak.mockImplementation(async () => {
      vi.advanceTimersByTime(430);
      return {
        audio: Buffer.from([1, 2, 3]),
        mime: 'audio/mpeg',
        characters: 24,
        provider: 'elevenlabs',
        model: 'eleven_turbo_v2_5',
      };
    });

    try {
      await serveQuestionSpeech(ttsReq(), ttsRes(), (() => undefined) as never);
    } finally {
      vi.useRealTimers();
    }

    expect(m.recordLlmCall.mock.calls[0]?.[0]).toMatchObject({ latency_ms: 430 });
  });

  it('a throwing provider bills nothing', async () => {
    m.speak.mockRejectedValue(new ApiError('VOICE_UNAVAILABLE'));

    await expect(
      serveQuestionSpeech(ttsReq(), ttsRes(), (() => undefined) as never),
    ).rejects.toMatchObject({ code: 'VOICE_UNAVAILABLE' });

    expect(m.recordLlmCall).not.toHaveBeenCalled();
  });

  it('a request that lost the cache race under the lock bills nothing', async () => {
    // Two first requests for the same question both miss the pre-lock read, then serialise on
    // the budget lock. This is the loser: by the time it holds the lock the winner has stored
    // the audio, so the re-read under the lock hits and no second call is bought.
    m.storageGet.mockReset();
    m.storageGet
      .mockRejectedValueOnce(new Error('cache miss'))
      .mockResolvedValueOnce(Buffer.from([7, 7, 7]));

    await serveQuestionSpeech(ttsReq(), ttsRes(), (() => undefined) as never);

    expect(m.storageGet).toHaveBeenCalledTimes(2);
    expect(m.speak).not.toHaveBeenCalled();
    expect(m.recordLlmCall).not.toHaveBeenCalled();
    expect(m.storagePut).not.toHaveBeenCalled();
  });

  it('a failed cache write still serves the bytes it already paid for', async () => {
    // A 500 here would be billed twice: the candidate retries and buys the same audio again.
    m.storagePut.mockRejectedValue(new Error('s3 down'));

    await serveQuestionSpeech(ttsReq(), ttsRes(), (() => undefined) as never);

    expect(m.recordLlmCall).toHaveBeenCalledOnce();
    expect(m.loggerWarn.mock.calls.at(-1)?.[1]).toBe('SPEECH_TTS_CACHE_WRITE_FAILED');
  });

  it('an over-budget interview never calls the provider and ends budget_exhausted', async () => {
    m.withBudget.mockRejectedValue(new m.BudgetExceeded());

    await expect(
      serveQuestionSpeech(ttsReq(), ttsRes(), (() => undefined) as never),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });

    expect(m.speak).not.toHaveBeenCalled();
    expect(m.recordLlmCall).not.toHaveBeenCalled();
    expect(m.applyTransition.mock.calls[0]?.[2]?.endedReason).toBe('budget_exhausted');
  });
});

describe('submitAnswerAudio metering', () => {
  it('a successful call records exactly one second row and advances', async () => {
    const { r } = sttRes();

    await submitAnswerAudio(sttReq(), r, (() => undefined) as never);

    expect(m.transcribe).toHaveBeenCalledOnce();
    expect(m.recordLlmCall).toHaveBeenCalledOnce();
    expect(m.recordLlmCall.mock.calls[0]?.[0]).toMatchObject({
      model: 'scribe_v1',
      unit_kind: 'second',
      units: 12,
    });
    expect(m.advance).toHaveBeenCalledOnce();
  });

  it('stores how long the provider call actually took', async () => {
    vi.useFakeTimers();
    m.transcribe.mockImplementation(async () => {
      vi.advanceTimersByTime(1650);
      return {
        transcript: 'A spoken answer.',
        seconds: 12,
        provider: 'elevenlabs',
        model: 'scribe_v1',
      };
    });
    const { r } = sttRes();

    try {
      await submitAnswerAudio(sttReq(), r, (() => undefined) as never);
    } finally {
      vi.useRealTimers();
    }

    expect(m.recordLlmCall.mock.calls[0]?.[0]).toMatchObject({ latency_ms: 1650 });
  });

  it('a throwing provider bills nothing and does not advance', async () => {
    m.transcribe.mockRejectedValue(new ApiError('VOICE_UNAVAILABLE'));
    const { r } = sttRes();

    await expect(submitAnswerAudio(sttReq(), r, (() => undefined) as never)).rejects.toMatchObject({
      code: 'VOICE_UNAVAILABLE',
    });

    expect(m.recordLlmCall).not.toHaveBeenCalled();
    expect(m.advance).not.toHaveBeenCalled();
  });

  it('an over-budget interview never calls the provider and ends budget_exhausted', async () => {
    m.withBudget.mockRejectedValue(new m.BudgetExceeded());
    const { r } = sttRes();

    await expect(submitAnswerAudio(sttReq(), r, (() => undefined) as never)).rejects.toMatchObject({
      code: 'BUDGET_EXCEEDED',
    });

    expect(m.transcribe).not.toHaveBeenCalled();
    expect(m.recordLlmCall).not.toHaveBeenCalled();
    expect(m.advance).not.toHaveBeenCalled();
    expect(m.applyTransition.mock.calls[0]?.[2]?.endedReason).toBe('budget_exhausted');
  });
});
