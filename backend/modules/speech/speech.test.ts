import { afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ loggerInfo: vi.fn(), loggerWarn: vi.fn() }));
vi.mock('../../src/lib/logger', () => ({
  logger: { info: m.loggerInfo, warn: m.loggerWarn, error: vi.fn() },
}));

import { ApiError } from '../../src/lib/api-error';
import { ElevenLabsSpeech } from './elevenlabs-speech';
import { FakeSpeechProvider } from './fake-speech';
import type { SpeechProvider } from './SpeechProvider';

const ctx = { interviewId: 'itv_1', traceId: 'trace_1' };

describe('FakeSpeechProvider', () => {
  it('satisfies the SpeechProvider interface', async () => {
    const fake: SpeechProvider = new FakeSpeechProvider();
    const speak = await fake.speak('hello', { voiceId: 'v-1', language: 'en', ctx });
    expect(speak.audio.length).toBeGreaterThan(0);
    expect(speak.mime).toBe('audio/mpeg');
    expect(speak.characters).toBe(5);

    const transcribe = await fake.transcribe(Buffer.alloc(64), { mime: 'audio/mpeg', language: 'en' });
    expect(transcribe.transcript.length).toBeGreaterThan(0);
    expect(transcribe.seconds).toBeGreaterThan(0);
  });

  it('names itself, so nothing it returns can be metered as ElevenLabs spend', async () => {
    const fake = new FakeSpeechProvider();

    const speak = await fake.speak('hello', { voiceId: 'v-1', language: 'en', ctx });
    expect(speak).toMatchObject({ provider: 'fake', model: 'fake' });

    const transcribe = await fake.transcribe(Buffer.alloc(64), { mime: 'audio/mpeg', language: 'en' });
    expect(transcribe).toMatchObject({ provider: 'fake', model: 'fake' });
  });

  it('failNext() throws exactly once then recovers', async () => {
    const fake = new FakeSpeechProvider();
    fake.failNext();

    await expect(fake.speak('x', { voiceId: 'v', language: 'en', ctx })).rejects.toThrow(ApiError);

    // second call must succeed
    const result = await fake.speak('x', { voiceId: 'v', language: 'en', ctx });
    expect(result.mime).toBe('audio/mpeg');
  });

  it('failNext() also works on transcribe()', async () => {
    const fake = new FakeSpeechProvider();
    fake.failNext();

    await expect(
      fake.transcribe(Buffer.alloc(8), { mime: 'audio/mpeg', language: 'en' }),
    ).rejects.toThrow(ApiError);

    // second call must succeed
    const result = await fake.transcribe(Buffer.alloc(8), { mime: 'audio/mpeg', language: 'en' });
    expect(result.transcript.length).toBeGreaterThan(0);
  });
});

describe('ElevenLabsSpeech — voice generation debug line', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    m.loggerInfo.mockReset();
  });

  it('logs AI_VOICE_GENERATION_DEBUG once, carrying the interview id and the spoken text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([0xff, 0xfb]), { status: 200 })),
    );
    const driver = new ElevenLabsSpeech('key', 'eleven_multilingual_v2', 'scribe_v1');
    await driver.speak('Tell me about a hard bug.', { voiceId: 'v-1', language: 'en', ctx });

    const debug = m.loggerInfo.mock.calls.filter(([, event]) => event === 'AI_VOICE_GENERATION_DEBUG');
    expect(debug).toHaveLength(1);
    expect(debug[0][0]).toMatchObject({
      promptName: 'elevenlabs.text-to-speech',
      provider: 'elevenlabs',
      model: 'eleven_multilingual_v2',
      interviewId: ctx.interviewId,
      traceId: ctx.traceId,
      content: 'Tell me about a hard bug.',
    });
  });

  it('logs nothing when the key is missing — no call was made', async () => {
    const driver = new ElevenLabsSpeech('', 'eleven_multilingual_v2', 'scribe_v1');
    await expect(driver.speak('x', { voiceId: 'v', language: 'en', ctx })).rejects.toThrow(ApiError);
    expect(m.loggerInfo).not.toHaveBeenCalled();
  });
});

describe('ElevenLabsSpeech — empty key guard', () => {
  it('speak() throws VOICE_UNAVAILABLE without calling fetch when apiKey is empty', async () => {
    const driver = new ElevenLabsSpeech('', 'eleven_multilingual_v2', 'scribe_v1');
    await expect(driver.speak('hello', { voiceId: 'v-1', language: 'en', ctx })).rejects.toThrow(
      ApiError,
    );
  });

  it('transcribe() throws VOICE_UNAVAILABLE without calling fetch when apiKey is empty', async () => {
    const driver = new ElevenLabsSpeech('', 'eleven_multilingual_v2', 'scribe_v1');
    await expect(
      driver.transcribe(Buffer.alloc(8), { mime: 'audio/mpeg', language: 'en' }),
    ).rejects.toThrow(ApiError);
  });
});

/**
 * The multipart Scribe actually accepts. `POST /v1/speech-to-text` names the part `file`; any
 * other name is answered
 * `400 {"code":"invalid_parameters","message":"Must provide either file or a URL parameter."}`
 * — probed against the real endpoint, not read off a doc. The retry loop then burns all three
 * attempts on a request that can never succeed and the interview downgrades to text, which is
 * indistinguishable from a provider outage.
 */
describe('ElevenLabsSpeech — the STT request shape', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the recording as the "file" part, with the model and language beside it', async () => {
    const sent: FormData[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        sent.push(init?.body as FormData);
        return new Response(JSON.stringify({ text: 'hello', words: [{ end: 1.5 }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const driver = new ElevenLabsSpeech('key', 'eleven_multilingual_v2', 'scribe_v1');
    const result = await driver.transcribe(Buffer.from([1, 2, 3]), {
      mime: 'audio/webm',
      language: 'en',
    });

    expect(result).toEqual({
      provider: 'elevenlabs',
      model: 'scribe_v1',
      transcript: 'hello',
      seconds: 1.5,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].get('file')).toBeInstanceOf(Blob);
    expect(sent[0].get('audio')).toBeNull();
    expect(sent[0].get('model_id')).toBe('scribe_v1');
    expect(sent[0].get('language_code')).toBe('en');
  });
});

describe('ElevenLabsSpeech — what the call reports about itself', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    m.loggerWarn.mockReset();
  });

  it('speak() reports the provider and the model id it actually sent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([0xff, 0xfb]), { status: 200 })),
    );

    const driver = new ElevenLabsSpeech('key', 'eleven_turbo_v2_5', 'scribe_v1');
    const result = await driver.speak('hello', { voiceId: 'v-1', language: 'en', ctx });

    expect(result).toMatchObject({ provider: 'elevenlabs', model: 'eleven_turbo_v2_5' });
  });

  it('speak() counts an emoji as the one character the provider bills for', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([0xff, 0xfb]), { status: 200 })),
    );

    const driver = new ElevenLabsSpeech('key', 'eleven_turbo_v2_5', 'scribe_v1');
    const result = await driver.speak('hi 👋', { voiceId: 'v-1', language: 'en', ctx });

    expect(result.characters).toBe(4);
  });

  it('transcribe() bills the floor and logs when the response carries no word timings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ text: '' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    const driver = new ElevenLabsSpeech('key', 'eleven_turbo_v2_5', 'scribe_v1');
    const result = await driver.transcribe(Buffer.from([1, 2, 3]), {
      mime: 'audio/webm',
      language: 'en',
    });

    expect(result.seconds).toBe(1);
    expect(m.loggerWarn.mock.calls.map(([, event]) => event)).toContain('SPEECH_STT_NO_TIMINGS');
  });
});

describe('ElevenLabsSpeech — retry only what is retryable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    m.loggerWarn.mockReset();
  });

  it('a 401 quota-exhausted response calls fetch once and throws VOICE_UNAVAILABLE', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: { status: 'quota_exceeded', message: 'out of credits' } }), {
          status: 401,
          statusText: 'Unauthorized',
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const driver = new ElevenLabsSpeech('key', 'eleven_multilingual_v2', 'scribe_v1');
    await expect(driver.speak('hello', { voiceId: 'v-1', language: 'en', ctx })).rejects.toMatchObject({
      code: 'VOICE_UNAVAILABLE',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('a 500 still retries 3 times then throws VOICE_UNAVAILABLE', async () => {
    const fetchMock = vi.fn(async () => new Response('server on fire', { status: 500, statusText: 'Internal Server Error' }));
    vi.stubGlobal('fetch', fetchMock);

    const driver = new ElevenLabsSpeech('key', 'eleven_multilingual_v2', 'scribe_v1');
    await expect(driver.speak('hello', { voiceId: 'v-1', language: 'en', ctx })).rejects.toMatchObject({
      code: 'VOICE_UNAVAILABLE',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('the failure log carries the quota detail from the response body', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: { status: 'quota_exceeded', message: 'out of credits' } }), {
          status: 401,
          statusText: 'Unauthorized',
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const driver = new ElevenLabsSpeech('key', 'eleven_multilingual_v2', 'scribe_v1');
    await expect(driver.speak('hello', { voiceId: 'v-1', language: 'en', ctx })).rejects.toThrow();

    const failed = m.loggerWarn.mock.calls.find(([, event]) => event === 'SPEECH_TTS_FAILED');
    expect(failed?.[0]).toMatchObject({ status: 401, detail: 'quota_exceeded' });
  });

  it('transcribe(): a 402 quota-exhausted response calls fetch once and throws VOICE_UNAVAILABLE', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: { status: 'quota_exceeded', message: 'out of credits' } }), {
          status: 402,
          statusText: 'Payment Required',
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const driver = new ElevenLabsSpeech('key', 'eleven_multilingual_v2', 'scribe_v1');
    await expect(
      driver.transcribe(Buffer.from([1, 2, 3]), { mime: 'audio/webm', language: 'en' }),
    ).rejects.toMatchObject({ code: 'VOICE_UNAVAILABLE' });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('transcribe(): a 429 still retries 3 times then throws VOICE_UNAVAILABLE', async () => {
    const fetchMock = vi.fn(async () => new Response('slow down', { status: 429, statusText: 'Too Many Requests' }));
    vi.stubGlobal('fetch', fetchMock);

    const driver = new ElevenLabsSpeech('key', 'eleven_multilingual_v2', 'scribe_v1');
    await expect(
      driver.transcribe(Buffer.from([1, 2, 3]), { mime: 'audio/webm', language: 'en' }),
    ).rejects.toMatchObject({ code: 'VOICE_UNAVAILABLE' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
