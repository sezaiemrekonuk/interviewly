import { describe, expect, it } from 'vitest';

import { ApiError } from '../../src/lib/api-error';
import { ElevenLabsSpeech } from './elevenlabs-speech';
import { FakeSpeechProvider } from './fake-speech';
import type { SpeechProvider } from './SpeechProvider';

describe('FakeSpeechProvider', () => {
  it('satisfies the SpeechProvider interface', async () => {
    const fake: SpeechProvider = new FakeSpeechProvider();
    const speak = await fake.speak('hello', { voiceId: 'v-1', language: 'en' });
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

    await expect(fake.speak('x', { voiceId: 'v', language: 'en' })).rejects.toThrow(ApiError);

    // second call must succeed
    const result = await fake.speak('x', { voiceId: 'v', language: 'en' });
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

describe('ElevenLabsSpeech — empty key guard', () => {
  it('speak() throws VOICE_UNAVAILABLE without calling fetch when apiKey is empty', async () => {
    const driver = new ElevenLabsSpeech('', 'eleven_multilingual_v2', 'scribe_v1');
    await expect(driver.speak('hello', { voiceId: 'v-1', language: 'en' })).rejects.toThrow(
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
