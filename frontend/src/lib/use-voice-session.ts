// W10 — the realtime session behind voice mode, over V02's mint (`lib/voice/session.ts`).
//
// K11: this hook emits LOCAL avatar beats only. It never advances the room index, never fills
// the transcript and never reads room state. Truth arrives through `GET /interviews/:id/state`
// (see `room-avatar.ts`, `use-interview-events.ts`); the socket only says what is happening
// *right now* so the avatar has something to do between refetches.
//
// Answers do not travel this socket either: V02 receives them server-side over the ElevenLabs
// webhooks, which is why there is no send path here beyond the init frame.
import { useCallback, useEffect, useRef, useState } from 'react';

import { mintVoiceSession } from '@/lib/voice/session';
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
  /** Voice mode only — a text interview must not mint a session or open a mic. */
  enabled?: boolean;
  /**
   * Called once the session is (re)established, and once when a mint is refused. Both are
   * moments where the server's truth may have moved underneath us — V05 reconciles the
   * server side, and the client catches up by refetching state, never from this socket.
   */
  onResync?: () => void;
}

/**
 * Agent frame → local beat. Anything not listed leaves the beat alone: a `ping` or an audio
 * chunk is not a turn boundary, and treating it as one makes the avatar twitch every frame.
 */
const BEAT_BY_FRAME: Record<string, VoiceBeat> = {
  agent_response: 'speaking',
  audio: 'speaking',
  agent_response_end: 'listening',
  interruption: 'listening',
  user_transcript: 'acknowledging',
};

/** What the socket has reported, tagged with the attempt it belongs to (see `status` below). */
interface LiveState {
  attempt: number;
  status: VoiceConnectionStatus;
  beat: VoiceBeat;
}

export function useVoiceSession(
  interviewId: string | null,
  options: UseVoiceSessionOptions = {},
): UseVoiceSessionResult {
  const { enabled = true, onResync } = options;

  const [attempt, setAttempt] = useState(0);
  const [live, setLive] = useState<LiveState | null>(null);

  const mic = useMicPermission();

  // `onResync` is a fresh closure on every render of the page; keeping it in a ref stops the
  // connect effect from tearing the socket down once per render.
  const resyncRef = useRef(onResync);
  useEffect(() => {
    resyncRef.current = onResync;
  });

  const { request: requestMic } = mic;
  const active = enabled && Boolean(interviewId);

  useEffect(() => {
    if (active) requestMic();
  }, [active, requestMic]);

  useEffect(() => {
    if (!active || !interviewId) return;

    // `closing` distinguishes our own teardown from a drop: React StrictMode and every
    // unmount run this cleanup, and a cleanup must not surface as a lost session.
    let closing = false;
    let socket: WebSocket | null = null;

    void (async () => {
      const minted = await mintVoiceSession(interviewId);
      if (closing) return;

      if (!minted.ok || !minted.data) {
        // V03 already flipped the interview to text server-side on a fatal mint (VOICE_UNAVAILABLE),
        // so the downgrade is not ours to perform — the refetch is what surfaces it.
        setLive({ attempt, status: 'lost', beat: null });
        resyncRef.current?.();
        return;
      }

      if (typeof WebSocket === 'undefined') {
        setLive({ attempt, status: 'lost', beat: null });
        return;
      }

      const { token, wssOrigin, dynamicVars } = minted.data;
      socket = new WebSocket(wssOrigin);

      socket.addEventListener('open', () => {
        if (closing) return;
        // The token goes in the init frame, not the URL: a query string lands in proxy access
        // logs, and this one is a session credential (K6).
        socket?.send(
          JSON.stringify({
            type: 'conversation_initiation_client_data',
            token,
            dynamic_variables: dynamicVars,
          }),
        );
        setLive({ attempt, status: 'connected', beat: 'listening' });
        // A reconnect may have straddled a server-side advance (V05 reconciliation) — resync.
        if (attempt > 0) resyncRef.current?.();
      });

      socket.addEventListener('message', (event) => {
        if (closing) return;
        let frame: { type?: unknown };
        try {
          frame = JSON.parse(String((event as MessageEvent).data)) as { type?: unknown };
        } catch {
          return;
        }
        const next = typeof frame.type === 'string' ? BEAT_BY_FRAME[frame.type] : undefined;
        if (next === undefined) return;
        setLive((prev) => (prev?.attempt === attempt ? { ...prev, beat: next } : prev));
      });

      const drop = () => {
        if (closing) return;
        setLive({ attempt, status: 'lost', beat: null });
      };
      socket.addEventListener('close', drop);
      socket.addEventListener('error', drop);
    })();

    return () => {
      closing = true;
      socket?.close();
    };
    // The mic stream is owned by `useMicPermission`, which stops its tracks on unmount — that
    // is the no-hot-mic guarantee, and it must not be duplicated here.
  }, [active, interviewId, attempt]);

  // Derived, not stored. A new attempt is "connecting"/"reconnecting" by definition, so tagging
  // the socket's reports with their attempt lets the effect start a connection without a
  // synchronous setState to clear the previous one's status and beat.
  const current = live?.attempt === attempt ? live : null;
  const status: VoiceConnectionStatus = current
    ? current.status
    : attempt === 0
      ? 'connecting'
      : 'reconnecting';

  const reconnect = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    status,
    beat: current?.beat ?? null,
    micLevel: mic.muted ? 0 : mic.level,
    muted: mic.muted,
    micState: mic.state,
    toggleMute: mic.toggleMute,
    reconnect,
  };
}
