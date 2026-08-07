import { AI_VOICE_DEBUG_EVENT, logAiCall } from '@interviewly/ai';

import type { SpeechCtx, SpeechProvider } from './SpeechProvider';
import { ApiError } from '../../src/lib/api-error';
import { logger } from '../../src/lib/logger';

const TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 3;

interface ScribeResponse {
  text: string;
  words?: Array<{ end: number }>;
}

async function callWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class ElevenLabsSpeech implements SpeechProvider {
  constructor(
    private readonly apiKey: string,
    private readonly ttsModel: string,
    private readonly sttModel: string,
  ) {}

  async speak(
    text: string,
    opts: { voiceId: string; language: string; ctx: SpeechCtx },
  ): Promise<{ audio: Buffer; mime: string; characters: number }> {
    if (!this.apiKey) throw new ApiError('VOICE_UNAVAILABLE');

    logAiCall(logger, {
      event: AI_VOICE_DEBUG_EVENT,
      promptName: 'elevenlabs.text-to-speech',
      interviewId: opts.ctx.interviewId,
      traceId: opts.ctx.traceId,
      provider: 'elevenlabs',
      model: this.ttsModel,
      messages: [{ role: 'user', content: text }],
    });

    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const res = await callWithTimeout(
          `https://api.elevenlabs.io/v1/text-to-speech/${opts.voiceId}`,
          {
            method: 'POST',
            headers: { 'xi-api-key': this.apiKey, 'content-type': 'application/json' },
            body: JSON.stringify({ text, model_id: this.ttsModel, language_code: opts.language }),
          },
        );
        if (res.ok) {
          const audio = Buffer.from(await res.arrayBuffer());
          return { audio, mime: 'audio/mpeg', characters: text.length };
        }
        logger.warn({ status: res.status, reason: res.statusText }, 'SPEECH_TTS_FAILED');
        lastErr = new Error(`ElevenLabs TTS ${res.status} ${res.statusText}`);
      } catch (err) {
        lastErr = err;
      }
    }
    logger.warn({ err: lastErr }, 'VOICE_UNAVAILABLE');
    throw new ApiError('VOICE_UNAVAILABLE');
  }

  async transcribe(
    audio: Buffer,
    opts: { mime: string; language: string },
  ): Promise<{ transcript: string; seconds: number }> {
    if (!this.apiKey) throw new ApiError('VOICE_UNAVAILABLE');

    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const form = new FormData();
        form.append(
          'audio',
          new Blob([Uint8Array.from(audio)], { type: opts.mime }),
          'audio.webm',
        );
        form.append('model_id', this.sttModel);
        form.append('language_code', opts.language);

        const res = await callWithTimeout('https://api.elevenlabs.io/v1/speech-to-text', {
          method: 'POST',
          headers: { 'xi-api-key': this.apiKey },
          body: form,
        });
        if (res.ok) {
          const data = (await res.json()) as ScribeResponse;
          const transcript = data.text ?? '';
          const seconds = data.words?.at(-1)?.end ?? 0;
          return { transcript, seconds };
        }
        logger.warn({ status: res.status, reason: res.statusText }, 'SPEECH_STT_FAILED');
        lastErr = new Error(`ElevenLabs STT ${res.status} ${res.statusText}`);
      } catch (err) {
        lastErr = err;
      }
    }
    logger.warn({ err: lastErr }, 'VOICE_UNAVAILABLE');
    throw new ApiError('VOICE_UNAVAILABLE');
  }
}
