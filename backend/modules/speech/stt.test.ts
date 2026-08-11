import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  activeInterview: vi.fn(),
  currentQuestion: vi.fn(),
  applyTransition: vi.fn(),
  transcribe: vi.fn(),
  advance: vi.fn(),
  conduct: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  now: vi.fn(() => new Date('2026-08-06T10:10:00.000Z')),
}));

vi.mock('../../src/lib/clock', () => ({ clock: { now: m.now } }));
vi.mock('../../src/lib/env', () => ({
  config: { VOICE_MAX_ROUND_SECONDS: 720, VOICE_MAX_INTERVIEW_SECONDS: 1500 },
}));
vi.mock('../../src/lib/db', () => ({
  activeInterview: m.activeInterview,
  prisma: { interviewRound: { findFirstOrThrow: vi.fn() } },
}));
vi.mock('../interview/state', () => ({ currentQuestionRow: m.currentQuestion }));
vi.mock('../interview/machine', () => ({ applyTransition: m.applyTransition }));
vi.mock('../../src/lib/storage', () => ({ storage: { get: vi.fn(), put: vi.fn() } }));
vi.mock('../voice/downgrade', () => ({ downgradeToText: vi.fn() }));
vi.mock('./SpeechProvider', () => ({ speechProvider: { transcribe: m.transcribe } }));
vi.mock('../../src/lib/logger', () => ({ logger: { info: m.loggerInfo, error: m.loggerError } }));
vi.mock('../auth/middleware', () => ({ requireAuth: function requireAuth() {} }));
vi.mock('../interview/csrf', () => ({ requirePublicOrigin: function requirePublicOrigin() {} }));

// answers.ts's transitive deps are mocked only so `importActual` resolves cheaply — the real
// `answerInputSchema` (a zod schema) is what the handler must validate the transcript against.
vi.mock('../interview/adaptive', () => ({ promoteNextQuestion: vi.fn() }));
vi.mock('../interview/budget', () => ({
  withBudget: async (_id: string, fn: () => Promise<unknown>) => fn(),
  BudgetExceeded: class extends Error {},
}));
vi.mock('./metering', () => ({ meterStt: vi.fn() }));
vi.mock('../interview/generation', () => ({ ensureTechBatch: vi.fn() }));
vi.mock('../interview/language', () => ({ trackLanguage: vi.fn() }));
vi.mock('../interview/answers', async (orig) => {
  const actual = await orig<typeof import('../interview/answers')>();
  return { answerInputSchema: actual.answerInputSchema, advanceWithAnswer: m.advance };
});
// Same shape for C06's turn path: the real `turnInputSchema` is the boundary the transcript
// must survive, so it is NOT stubbed — only the conducting itself is.
vi.mock('../interview/conductor', async (orig) => {
  const actual = await orig<typeof import('../interview/conductor')>();
  return { turnInputSchema: actual.turnInputSchema, conductTurn: m.conduct };
});

import { type Request, type Response } from 'express';

import { ApiError } from '../../src/lib/api-error';

import speechRouter from './router';
import { guardVoiceAnswer, submitAnswerAudio, submitTurnAudio } from './stt';

const interview = {
  id: 'itv-1',
  user_id: 'u-1',
  mode: 'voice',
  state: 'hr_round',
  current_index: 1,
  hr_question_count: 2,
  language: 'en',
  started_at: new Date('2026-08-06T10:00:00.000Z'),
  // I16 — the ceiling reads these, not `started_at`. Out of time means "spent 720 s in the
  // room", which advancing `m.now` no longer produces.
  elapsed_seconds: 0,
  last_seen_at: null,
  max_duration_seconds: null,
  ended_reason: null,
};

function req(overrides: Partial<Record<string, unknown>> = {}): Request {
  return {
    params: { id: interview.id },
    user: { id: interview.user_id },
    traceId: 'trace-1',
    body: { questionId: 'q-1' },
    file: { buffer: Buffer.from([1, 2, 3, 4]), size: 4, mimetype: 'audio/webm' },
    ...overrides,
  } as unknown as Request;
}

function res(locals: Record<string, unknown> = { interview: { ...interview } }) {
  const out: { status?: number; body?: unknown } = {};
  const r = {
    locals,
    status(code: number) {
      out.status = code;
      return r;
    },
    json(body: unknown) {
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
  m.transcribe.mockResolvedValue({ transcript: 'A spoken answer.', seconds: 12 });
  m.advance.mockResolvedValue({ state: 'hr_round', nextIndex: 2 });
  m.conduct.mockResolvedValue({ state: 'hr_round', currentIndex: 1 });
  m.applyTransition.mockImplementation(async (row: { ended_reason: string | null }, _to, ctx: { endedReason?: string }) => {
    row.ended_reason = ctx.endedReason ?? null;
    return 'evaluating';
  });
});

describe('guardVoiceAnswer', () => {
  it('stashes the interview and calls next for the owner in a voice-capable state', async () => {
    const { r } = res({});
    const next = vi.fn();

    await guardVoiceAnswer(req(), r, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
    expect((r.locals as { interview?: { id: string } }).interview?.id).toBe(interview.id);
  });

  it('rejects a non-owner before any body work', async () => {
    m.activeInterview.mockResolvedValue({ ...interview, user_id: 'someone-else' });
    const { r } = res({});

    await expect(guardVoiceAnswer(req(), r, vi.fn())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('past the ceiling ends the interview and never reaches the body', async () => {
    m.activeInterview.mockResolvedValue({ ...interview, elapsed_seconds: 721 });
    const { r } = res({});
    const next = vi.fn();

    await expect(guardVoiceAnswer(req(), r, next)).rejects.toMatchObject({
      code: 'VOICE_SESSION_EXPIRED',
    });

    expect(m.applyTransition.mock.calls[0]?.[2]?.endedReason).toBe('time_exhausted');
    expect(next).not.toHaveBeenCalled();
  });

  it('a losing ceiling transition still surfaces VOICE_SESSION_EXPIRED (ADR-I32)', async () => {
    m.activeInterview.mockResolvedValue({ ...interview, elapsed_seconds: 721 });
    m.applyTransition.mockRejectedValue(new ApiError('INVALID_STATE_TRANSITION'));
    const { r } = res({});

    await expect(guardVoiceAnswer(req(), r, vi.fn())).rejects.toMatchObject({
      code: 'VOICE_SESSION_EXPIRED',
    });
  });
});

describe('submitAnswerAudio', () => {
  it('transcribes then delegates one voice answer to advanceWithAnswer', async () => {
    const { r, out } = res();

    await submitAnswerAudio(req(), r, (() => undefined) as never);

    expect(m.advance).toHaveBeenCalledOnce();
    expect(m.advance.mock.calls[0]?.[1]).toEqual({
      questionId: 'q-1',
      transcript: 'A spoken answer.',
      inputMode: 'voice',
    });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ state: 'hr_round', nextIndex: 2 });
  });

  it('a stale questionId is rejected before the provider is called', async () => {
    const stale = req({ body: { questionId: 'q-0-already-answered' } });
    const { r } = res();

    await expect(submitAnswerAudio(stale, r, (() => undefined) as never)).rejects.toMatchObject({
      code: 'QUESTION_NOT_CURRENT',
    });

    expect(m.transcribe).not.toHaveBeenCalled();
    expect(m.advance).not.toHaveBeenCalled();
  });

  it('a missing questionId field is a validation error before the provider', async () => {
    const missing = req({ body: {} });
    const { r } = res();

    await expect(submitAnswerAudio(missing, r, (() => undefined) as never)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    expect(m.transcribe).not.toHaveBeenCalled();
  });

  it('an empty transcript fails and writes no answer', async () => {
    m.transcribe.mockResolvedValue({ transcript: '   ', seconds: 0 });
    const { r } = res();

    await expect(submitAnswerAudio(req(), r, (() => undefined) as never)).rejects.toMatchObject({
      code: 'SPEECH_TRANSCRIPTION_FAILED',
    });

    expect(m.advance).not.toHaveBeenCalled();
  });

  it('rejects a missing audio part as invalid before the provider', async () => {
    const bad = req({ file: undefined });
    const { r } = res();

    await expect(submitAnswerAudio(bad, r, (() => undefined) as never)).rejects.toMatchObject({
      code: 'SPEECH_AUDIO_INVALID',
    });

    expect(m.transcribe).not.toHaveBeenCalled();
  });
});

/** C06 — the same recording, handed to the conductor instead of to the advance. */
describe('submitTurnAudio', () => {
  it('transcribes then hands one utterance to conductTurn', async () => {
    const { r, out } = res();

    await submitTurnAudio(req({ body: {} }), r, (() => undefined) as never);

    expect(m.conduct).toHaveBeenCalledOnce();
    expect(m.conduct.mock.calls[0]?.[1]).toEqual({
      text: 'A spoken answer.',
      inputMode: 'voice',
    });
    expect(m.advance).not.toHaveBeenCalled();
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ state: 'hr_round', currentIndex: 1 });
  });

  // The whole point of the route: a recording no longer consumes a question by arriving.
  it('needs no questionId and never checks the current question', async () => {
    const { r, out } = res();

    await submitTurnAudio(req({ body: {} }), r, (() => undefined) as never);

    expect(m.currentQuestion).not.toHaveBeenCalled();
    expect(out.status).toBe(200);
  });

  it('an empty transcript fails and conducts nothing', async () => {
    m.transcribe.mockResolvedValue({ transcript: '   ', seconds: 0 });
    const { r } = res();

    await expect(submitTurnAudio(req(), r, (() => undefined) as never)).rejects.toMatchObject({
      code: 'SPEECH_TRANSCRIPTION_FAILED',
    });

    expect(m.conduct).not.toHaveBeenCalled();
  });

  it('rejects a missing audio part as invalid before the provider', async () => {
    const { r } = res();

    await expect(
      submitTurnAudio(req({ file: undefined }), r, (() => undefined) as never),
    ).rejects.toMatchObject({ code: 'SPEECH_AUDIO_INVALID' });

    expect(m.transcribe).not.toHaveBeenCalled();
  });
});

describe('router', () => {
  it('runs the voice-answer guards before multer buffers the body', () => {
    const route = speechRouter.stack.find(
      (layer) => layer.route?.path === '/:id/answers/audio',
    )?.route;
    const names = route?.stack.map((layer) => layer.handle.name);

    expect(names).toEqual(['guardVoiceAnswer', 'uploadAudioMiddleware', 'submitAnswerAudio']);
  });

  it('guards the turn audio route the same way', () => {
    const route = speechRouter.stack.find(
      (layer) => layer.route?.path === '/:id/turns/audio',
    )?.route;
    const names = route?.stack.map((layer) => layer.handle.name);

    expect(names).toEqual(['guardVoiceAnswer', 'uploadTurnAudioMiddleware', 'submitTurnAudio']);
  });

  it('exposes the message speech route C06 added', () => {
    const paths = speechRouter.stack.map((layer) => layer.route?.path);
    expect(paths).toContain('/:id/messages/:messageId/speech');
  });
});
