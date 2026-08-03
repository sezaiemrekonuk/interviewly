import type { VoiceSession } from './VoiceSession';
import { ApiError } from '../../src/lib/api-error';

export class FakeVoiceSession implements VoiceSession {
  private _failNext = false;

  /** Forces the next mint call to throw VOICE_UNAVAILABLE (one-shot). V03 depends on this. */
  failNext(): void {
    this._failNext = true;
  }

  async mint(
    interviewId: string,
    _nonce: string,
    _ttlSeconds: number,
  ): Promise<{ token: string; wssOrigin: string }> {
    if (this._failNext) {
      this._failNext = false;
      throw new ApiError('VOICE_UNAVAILABLE');
    }
    return {
      token: `fake-token-${interviewId}`,
      wssOrigin: 'wss://fake.elevenlabs.io',
    };
  }
}
