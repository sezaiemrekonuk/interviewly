import type { SpeechProvider } from './SpeechProvider';
import { ApiError } from '../../src/lib/api-error';

// Fixed short MP3 header — enough for tests to assert a non-empty buffer with mpeg mime.
const FAKE_AUDIO = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00]);
const FAKE_TRANSCRIPT = 'This is a fake transcript.';

export class FakeSpeechProvider implements SpeechProvider {
  private _failNext = false;
  speakCalls = 0;
  transcribeCalls = 0;

  /** Forces the next provider call to throw VOICE_UNAVAILABLE (one-shot). */
  failNext(): void {
    this._failNext = true;
  }

  async speak(
    text: string,
    _opts: { voiceId: string; language: string },
  ): Promise<{ audio: Buffer; mime: string; characters: number }> {
    this.speakCalls += 1;
    if (this._failNext) {
      this._failNext = false;
      throw new ApiError('VOICE_UNAVAILABLE');
    }
    return { audio: FAKE_AUDIO, mime: 'audio/mpeg', characters: text.length };
  }

  async transcribe(
    audio: Buffer,
    _opts: { mime: string; language: string },
  ): Promise<{ transcript: string; seconds: number }> {
    this.transcribeCalls += 1;
    if (this._failNext) {
      this._failNext = false;
      throw new ApiError('VOICE_UNAVAILABLE');
    }
    // ponytail: 8 bytes/second is a rough estimate for MP3 at low bitrate — good enough for a fake
    const seconds = Math.max(1, audio.length / 8);
    return { transcript: FAKE_TRANSCRIPT, seconds };
  }
}
