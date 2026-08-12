import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  activeInterview: vi.fn(),
  currentQuestion: vi.fn(),
  applyTransition: vi.fn(),
  transcribe: vi.fn(),
  advance: vi.fn(),
  conduct: vi.fn(),
  take: vi.fn(),
  hold: vi.fn(),
  turnComplete: vi.fn(),
  withBudget: vi.fn(),
  prewarm: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
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
vi.mock('../../src/lib/logger', () => ({
  logger: { info: m.loggerInfo, warn: m.loggerWarn, error: m.loggerError, debug: vi.fn() },
}));
// T02's module is the real one — the two caps T03 enforces are read from it, not restated here
// — with only the shared Redis connection faked, so importing it opens no socket.
vi.mock('../auth/rate-limit', () => ({ redis: {} }));
vi.mock('./pending-turn', async (orig) => ({
  ...(await orig<typeof import('./pending-turn')>()),
  takePendingTurn: m.take,
  holdPendingTurn: m.hold,
}));
vi.mock('../ai', () => ({ aiClient: () => ({ turnComplete: m.turnComplete }) }));
vi.mock('../auth/middleware', () => ({ requireAuth: function requireAuth() {} }));
vi.mock('../interview/csrf', () => ({ requirePublicOrigin: function requirePublicOrigin() {} }));

// answers.ts's transitive deps are mocked only so `importActual` resolves cheaply — the real
// `answerInputSchema` (a zod schema) is what the handler must validate the transcript against.
vi.mock('../interview/adaptive', () => ({ promoteNextQuestion: vi.fn() }));
// A spy rather than a pass-through: the gate is a provider call and has to be billed by the
// same wrapper the transcription is (T03 non-negotiable, I08).
vi.mock('../interview/budget', () => ({
  withBudget: (id: string, fn: () => Promise<unknown>) => m.withBudget(id, fn),
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
// L02's eager synthesis is a floating provider call off the turn — spied here so the wiring is
// asserted without a real synthesise firing, while the pure ceiling helpers stay real.
vi.mock('./tts', async (orig) => ({
  ...(await orig<typeof import('./tts')>()),
  prewarmMessageSpeech: m.prewarm,
}));

import { type Request, type Response } from 'express';

import { ApiError } from '../../src/lib/api-error';

import { MAX_PENDING_CHARS, MAX_PROBES_PER_TURN } from './pending-turn';
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
  m.conduct.mockResolvedValue({ state: 'hr_round', currentIndex: 1, spokenIds: ['m-said'] });
  m.take.mockResolvedValue(null);
  m.hold.mockResolvedValue(undefined);
  m.turnComplete.mockResolvedValue({ finished: true });
  m.withBudget.mockImplementation((_id: string, fn: () => Promise<unknown>) => fn());
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
      kind: 'utterance',
      text: 'A spoken answer.',
      inputMode: 'voice',
    });
    expect(m.advance).not.toHaveBeenCalled();
    expect(out.status).toBe(200);
    // T03: `pendingTurn` is on every response of this route — null means the turn was conducted.
    // L02: the ids the turn wrote ride the same response, for the room to fetch their audio early.
    expect(out.body).toEqual({
      state: 'hr_round',
      currentIndex: 1,
      spokenIds: ['m-said'],
      pendingTurn: null,
    });
    // …and their synthesis is begun off the response, not left for the room's GET to trigger.
    expect(m.prewarm).toHaveBeenCalledWith('itv-1', 'm-said', 'trace-1');
  });

  // The whole point of the route: a recording no longer consumes a question by arriving. T03
  // reads the current row all the same — not to refuse the upload, but to key the held partial,
  // so a fragment spoken against a question the interview has left is dropped rather than joined.
  it('reads the current question to key the held partial, never to refuse the recording', async () => {
    const { r, out } = res();

    await submitTurnAudio(req({ body: {} }), r, (() => undefined) as never);

    expect(m.conduct).toHaveBeenCalledOnce();
    expect(out.status).toBe(200);
  });

  it('an empty transcript fails and conducts nothing', async () => {
    m.transcribe.mockResolvedValue({ transcript: '   ', seconds: 0 });
    const { r } = res();

    await expect(
      submitTurnAudio(req({ body: {} }), r, (() => undefined) as never),
    ).rejects.toMatchObject({ code: 'SPEECH_TRANSCRIPTION_FAILED' });

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

/**
 * T03 — the gate, the buffer, and the one field the route accepts.
 *
 * Every assertion here is about what was NOT done: no conductor call, no second user row, no
 * text off the wire, no verdict billed for an empty fragment. A turn that ends early is
 * indistinguishable from a working one in the response body — it is the conductor call count
 * and the held value that tell them apart.
 */
describe('submitTurnAudio — the completeness gate (T03)', () => {
  const held = (over: Partial<{ text: string; questionId: string; probes: number }> = {}) => ({
    text: 'So at my last company we',
    questionId: 'q-1',
    probes: 1,
    ...over,
  });

  // @AC-1
  it('holds an unfinished fragment: no conductor call, no chat row, the joined text returned', async () => {
    m.turnComplete.mockResolvedValue({ finished: false });
    const { r, out } = res();

    await submitTurnAudio(req({ body: {} }), r, (() => undefined) as never);

    expect(m.conduct).not.toHaveBeenCalled();
    expect(m.hold).toHaveBeenCalledWith('itv-1', {
      text: 'A spoken answer.',
      questionId: 'q-1',
      probes: 1,
    });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({
      state: 'hr_round',
      currentIndex: 1,
      pendingTurn: 'A spoken answer.',
    });
  });

  // @AC-2 — one user row carrying both fragments, which is what the report is scored from.
  it('joins a held partial with the new fragment into a single conducted utterance', async () => {
    m.take.mockResolvedValue(held());
    m.transcribe.mockResolvedValue({ transcript: 'rebuilt the ingest pipeline.', seconds: 4 });
    const { r, out } = res();

    await submitTurnAudio(req({ body: {} }), r, (() => undefined) as never);

    expect(m.turnComplete.mock.calls[0]?.[0]).toMatchObject({
      utterance: 'So at my last company we rebuilt the ingest pipeline.',
    });
    expect(m.conduct).toHaveBeenCalledOnce();
    expect(m.conduct.mock.calls[0]?.[1]).toEqual({
      kind: 'utterance',
      text: 'So at my last company we rebuilt the ingest pipeline.',
      inputMode: 'voice',
    });
    expect(m.hold).not.toHaveBeenCalled();
    expect(out.body).toMatchObject({ pendingTurn: null });
  });

  // @AC-3 — the trust boundary. A `pending` field would let a candidate post words they never
  // spoke into the utterance the conductor answers and the report scores.
  it('refuses a multipart text field, whatever it is called, before the provider', async () => {
    const { r } = res();

    await expect(
      submitTurnAudio(req({ body: { pending: 'words I never said' } }), r, (() => undefined) as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(m.transcribe).not.toHaveBeenCalled();
    expect(m.conduct).not.toHaveBeenCalled();
  });

  it('refuses a force field that is not the literal 1', async () => {
    const { r } = res();

    await expect(
      submitTurnAudio(req({ body: { force: 'yes' } }), r, (() => undefined) as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(m.transcribe).not.toHaveBeenCalled();
  });

  // @AC-4 — the gate itself never rejects (T01), but the budget wrapper around it does.
  it('forwards the utterance and logs CONDUCTOR_TURN_GATE_FAILED when the gate cannot answer', async () => {
    m.turnComplete.mockRejectedValue(new Error('gate unreachable'));
    const { r, out } = res();

    await submitTurnAudio(req({ body: {} }), r, (() => undefined) as never);

    expect(m.conduct).toHaveBeenCalledOnce();
    expect(m.hold).not.toHaveBeenCalled();
    expect(m.loggerWarn.mock.calls.map((c) => c[1])).toContain('CONDUCTOR_TURN_GATE_FAILED');
    expect(out.body).toMatchObject({ pendingTurn: null });
  });

  // @AC-6 — a thought aimed at a question the interview has left is not an answer to this one.
  it('drops a held partial from a past question instead of joining it', async () => {
    m.take.mockResolvedValue(held({ questionId: 'q-0' }));
    const { r } = res();

    await submitTurnAudio(req({ body: {} }), r, (() => undefined) as never);

    expect(m.conduct.mock.calls[0]?.[1]).toEqual({
      kind: 'utterance',
      text: 'A spoken answer.',
      inputMode: 'voice',
    });
  });

  // @AC-11 — manual Stop. All `force` buys is skipping a gate the candidate could skip by
  // waiting thirteen seconds anyway.
  it('force submits whatever the transcript looks like, without calling the gate', async () => {
    m.take.mockResolvedValue(held());
    m.transcribe.mockResolvedValue({ transcript: 'and', seconds: 1 });
    const { r } = res();

    await submitTurnAudio(req({ body: { force: '1' } }), r, (() => undefined) as never);

    expect(m.turnComplete).not.toHaveBeenCalled();
    expect(m.conduct.mock.calls[0]?.[1]).toMatchObject({
      text: 'So at my last company we and',
    });
  });

  // The loop stoppers. Both counters live in the stored value, out of the client's reach.
  it('skips the gate once the probe cap is spent', async () => {
    m.take.mockResolvedValue(held({ probes: MAX_PROBES_PER_TURN }));
    m.turnComplete.mockResolvedValue({ finished: false });
    const { r } = res();

    await submitTurnAudio(req({ body: {} }), r, (() => undefined) as never);

    expect(m.turnComplete).not.toHaveBeenCalled();
    expect(m.conduct).toHaveBeenCalledOnce();
    expect(m.hold).not.toHaveBeenCalled();
  });

  it('skips the gate once the joined text is past the character cap', async () => {
    m.take.mockResolvedValue(held({ text: 'x'.repeat(MAX_PENDING_CHARS) }));
    m.turnComplete.mockResolvedValue({ finished: false });
    const { r } = res();

    await submitTurnAudio(req({ body: {} }), r, (() => undefined) as never);

    expect(m.turnComplete).not.toHaveBeenCalled();
    expect(m.conduct).toHaveBeenCalledOnce();
  });

  // A probe that caught silence must not cost a verdict on nothing, and must not lose the
  // fragment that was already held.
  it('re-holds an unchanged partial when the fragment transcribes to nothing', async () => {
    m.take.mockResolvedValue(held());
    m.transcribe.mockResolvedValue({ transcript: '   ', seconds: 1 });
    const { r, out } = res();

    await submitTurnAudio(req({ body: {} }), r, (() => undefined) as never);

    expect(m.turnComplete).not.toHaveBeenCalled();
    expect(m.hold).toHaveBeenCalledWith('itv-1', held());
    expect(m.conduct).not.toHaveBeenCalled();
    expect(out.body).toMatchObject({ pendingTurn: 'So at my last company we' });
  });

  // I08: a provider call the interview cannot afford is not made twice — the gate is billed by
  // the same wrapper the transcription is.
  it('bills the gate inside withBudget', async () => {
    const { r } = res();

    await submitTurnAudio(req({ body: {} }), r, (() => undefined) as never);

    expect(m.withBudget).toHaveBeenCalledTimes(2);
    expect(m.withBudget.mock.calls.every((c) => c[0] === 'itv-1')).toBe(true);
  });

  it('never holds a partial the candidate did not speak into this question', async () => {
    m.take.mockResolvedValue(held({ questionId: 'q-0' }));
    m.turnComplete.mockResolvedValue({ finished: false });
    const { r } = res();

    await submitTurnAudio(req({ body: {} }), r, (() => undefined) as never);

    expect(m.hold).toHaveBeenCalledWith('itv-1', {
      text: 'A spoken answer.',
      questionId: 'q-1',
      probes: 1,
    });
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
