import { AI_VOICE_DEBUG_EVENT, logAiCall } from '@interviewly/ai';

import type { SpeechCallReport, SpeechCtx, SpeechProvider } from './SpeechProvider';
import { ApiError } from '../../src/lib/api-error';
import { logger } from '../../src/lib/logger';

const PROVIDER = 'elevenlabs';
const TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUSES = new Set([429]);
const MIN_BILLED_SECONDS = 1;

interface ScribeResponse {
  text: string;
  words?: Array<{ end: number }>;
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || RETRYABLE_STATUSES.has(status);
}

async function readErrorDetail(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(body) as { detail?: { status?: string } };
    return parsed.detail?.status ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
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
  ): Promise<SpeechCallReport & { audio: Buffer; mime: string; characters: number }> {
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
          return {
            provider: PROVIDER,
            model: this.ttsModel,
            audio,
            mime: 'audio/mpeg',
            characters: [...text].length,
          };
        }
        const detail = await readErrorDetail(res);
        logger.warn({ status: res.status, reason: res.statusText, detail }, 'SPEECH_TTS_FAILED');
        lastErr = new Error(`ElevenLabs TTS ${res.status} ${res.statusText}`);
        if (!isRetryableStatus(res.status)) break;
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
  ): Promise<SpeechCallReport & { transcript: string; seconds: number }> {
    if (!this.apiKey) throw new ApiError('VOICE_UNAVAILABLE');

    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const form = new FormData();
        // `file`, not `audio`: Scribe answers any other part name with
        // `400 invalid_parameters "Must provide either file or a URL parameter."`.
        form.append('file', new Blob([Uint8Array.from(audio)], { type: opts.mime }), 'audio.webm');
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
          const measuredSeconds = data.words?.at(-1)?.end;
          if (measuredSeconds === undefined) {
            logger.warn(
              { bytes: audio.length, billedSeconds: MIN_BILLED_SECONDS },
              'SPEECH_STT_NO_TIMINGS',
            );
          }
          return {
            provider: PROVIDER,
            model: this.sttModel,
            transcript,
            seconds: measuredSeconds ?? MIN_BILLED_SECONDS,
          };
        }
        const detail = await readErrorDetail(res);
        logger.warn({ status: res.status, reason: res.statusText, detail }, 'SPEECH_STT_FAILED');
        lastErr = new Error(`ElevenLabs STT ${res.status} ${res.statusText}`);
        if (!isRetryableStatus(res.status)) break;
      } catch (err) {
        lastErr = err;
      }
    }
    logger.warn({ err: lastErr }, 'VOICE_UNAVAILABLE');
    throw new ApiError('VOICE_UNAVAILABLE');
  }
}
