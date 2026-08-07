// W10, rewritten by S05. There is no realtime socket any more: ADR-S01 replaced the
// conversation agent with two server-side HTTP calls (TTS for the question, STT for the
// answer), so the mint, the socket dial and the agent frames it decoded are gone with it.
//
// What survives is the part that was never the socket's: the candidate's microphone. `status`
// now reports the mic, which is the only client-side thing a turn can be blocked on.
//
// K11 still holds: this hook never advances the room index, never fills the transcript and
// never reads room state. Truth arrives through `GET /interviews/:id/state`.
//
// ponytail: S06 drives `beat` from the turn loop it builds on top of this (play → VAD-record
// → upload → refetch). Until then nothing produces one and the avatar stays on `resolveAvatarState`.
import { useCallback, useEffect } from 'react';

import { useMicPermission, type MicPermissionState } from '@/lib/use-mic-permission';

export type VoiceConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'lost';

/** Local-only beat — never the sync value. `resolveAvatarState` still wins on 'settled'. */
export type VoiceBeat = 'listening' | 'speaking' | 'acknowledging' | null;

export interface UseVoiceSessionResult {
  status: VoiceConnectionStatus;
  beat: VoiceBeat;
  /** 0..1 RMS of the candidate's own mic, for the meter. Pinned to 0 while muted. */
  micLevel: number;
  muted: boolean;
  micState: MicPermissionState;
  toggleMute: () => void;
  reconnect: () => void;
}

export interface UseVoiceSessionOptions {
  /** Voice mode only — a text interview must not open a mic. */
  enabled?: boolean;
}

/**
 * `denied` and `unavailable` are both "this candidate cannot speak right now", which is what
 * the room's lost banner and its retry are for. `idle`/`prompt` are the permission round-trip.
 */
const STATUS_BY_MIC: Record<MicPermissionState, VoiceConnectionStatus> = {
  idle: 'connecting',
  prompt: 'connecting',
  granted: 'connected',
  denied: 'lost',
  unavailable: 'lost',
};

export function useVoiceSession(
  interviewId: string | null,
  options: UseVoiceSessionOptions = {},
): UseVoiceSessionResult {
  const { enabled = true } = options;

  const mic = useMicPermission();

  const { request: requestMic } = mic;
  const active = enabled && Boolean(interviewId);

  useEffect(() => {
    if (active) requestMic();
  }, [active, requestMic]);

  // Re-asking for the mic is the whole retry now — there is no connection to re-establish.
  const reconnect = useCallback(() => requestMic(), [requestMic]);

  return {
    status: STATUS_BY_MIC[mic.state],
    beat: null,
    micLevel: mic.muted ? 0 : mic.level,
    muted: mic.muted,
    micState: mic.state,
    toggleMute: mic.toggleMute,
    reconnect,
  };
}
