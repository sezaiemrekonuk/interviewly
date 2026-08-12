export interface SpeechCtx {
  interviewId: string;
  traceId: string;
}

export interface SpeechCallReport {
  provider: string;
  model: string;
}

export interface SpeechProvider {
  speak(text: string, opts: { voiceId: string; language: string; ctx: SpeechCtx }):
    Promise<SpeechCallReport & { audio: Buffer; mime: string; characters: number }>;
  transcribe(audio: Buffer, opts: { mime: string; language: string }):
    Promise<SpeechCallReport & { transcript: string; seconds: number }>;
}

// ponytail: module-level binding swapped wholesale by `setSpeechProvider` — same pattern
// as `src/lib/storage.ts:31,52`. The acceptance ring replaces it in a Before hook.
import { ElevenLabsSpeech } from './elevenlabs-speech';
import { config } from '../../src/lib/env';

// `?? ''` because the key is only a boot requirement under AI_ENABLED=true (env.ts's
// superRefine). In stub mode it is legitimately unset, and the driver's own `if (!this.apiKey)`
// guard turns that into VOICE_UNAVAILABLE without ever reaching fetch.
export let speechProvider: SpeechProvider = new ElevenLabsSpeech(
  config.ELEVENLABS_API_KEY ?? '',
  config.ELEVENLABS_TTS_MODEL,
  config.ELEVENLABS_STT_MODEL,
);

export function setSpeechProvider(next: SpeechProvider): void {
  speechProvider = next;
}
