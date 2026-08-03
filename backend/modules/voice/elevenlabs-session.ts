import type { VoiceSession } from './VoiceSession';
import { ApiError } from '../../src/lib/api-error';
import { config } from '../../src/lib/env';
import { logger } from '../../src/lib/logger';

const TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 3;

interface ElevenLabsTokenResponse {
  signed_url: string;
  wss_origin: string;
}

async function callWithTimeout(url: string, body: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': config.ELEVENLABS_API_KEY ?? '', 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export class ElevenLabsSession implements VoiceSession {
  async mint(
    interviewId: string,
    nonce: string,
    ttlSeconds: number,
  ): Promise<{ token: string; wssOrigin: string }> {
    // ponytail: linear retry, no jitter — upgrade to exponential if flakiness surfaces
    let _lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        // The agent id is inferred from the interview state; for now, the HR agent is used
        // for both round types. V01 only mints the token — routing by round type is V02's concern.
        const agentId = config.ELEVENLABS_AGENT_ID_HR ?? config.ELEVENLABS_AGENT_ID_TECH ?? '';
        const body = JSON.stringify({
          agent_id: agentId,
          dynamic_variables: { interviewId, nonce },
          overrides: { agent: { session_config: { max_duration_seconds: ttlSeconds } } },
        });
        const res = await callWithTimeout(
          'https://api.elevenlabs.io/v1/convai/conversation/get_signed_url',
          body,
        );
        if (!res.ok) {
          _lastError = new Error(`ElevenLabs ${res.status}`);
          continue;
        }
        const data = (await res.json()) as ElevenLabsTokenResponse;
        // signed_url is the WSS URL including the token; the origin is the base for CSP
        const wssOrigin = data.wss_origin ?? new URL(data.signed_url).origin;
        return { token: data.signed_url, wssOrigin };
      } catch (err) {
        _lastError = err;
      }
    }
    logger.warn({ interviewId }, 'VOICE_PROVIDER_MINT_FAILED');
    throw new ApiError('VOICE_UNAVAILABLE');
  }
}
