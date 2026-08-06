export interface SpeechProvider {
  speak(text: string, opts: { voiceId: string; language: string }):
    Promise<{ audio: Buffer; mime: string; characters: number }>;
  transcribe(audio: Buffer, opts: { mime: string; language: string }):
    Promise<{ transcript: string; seconds: number }>;
}

// ponytail: module-level binding swapped wholesale by `setSpeechProvider` — same pattern
// as `src/lib/storage.ts:31,52`. The acceptance ring replaces it in a Before hook.
import { ElevenLabsSpeech } from './elevenlabs-speech';
import { config } from '../../src/lib/env';

export let speechProvider: SpeechProvider = new ElevenLabsSpeech(
  config.ELEVENLABS_API_KEY,
  config.ELEVENLABS_TTS_MODEL,
  config.ELEVENLABS_STT_MODEL,
);

export function setSpeechProvider(next: SpeechProvider): void {
  speechProvider = next;
}
