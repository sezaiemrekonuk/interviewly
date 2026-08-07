import { afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ loggerInfo: vi.fn() }));
vi.mock('../../src/lib/logger', () => ({
  logger: { info: m.loggerInfo, warn: vi.fn(), error: vi.fn() },
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
