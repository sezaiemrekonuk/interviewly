// W10, rewritten by S05, given its turn loop by S06. There is no realtime socket any more:
// ADR-S01 replaced the conversation agent with two server-side HTTP calls (TTS for the
// question, STT for the answer), so the mint, the socket dial and the agent frames it decoded
// are gone with it.
//
// The loop is discrete (ADR-S06): play the question, record the answer, stop on silence,
// upload, refetch. K11 still holds — this hook never advances the room index, never fills the
// transcript and never reads room state. Truth arrives through `GET /interviews/:id/state`,
// and `turn` is that truth handed back down.
'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiGetBlob } from '@/lib/api';
import { queryKeys, useSubmitAudioAnswer, ApiError } from '@/lib/query';
import { useMicPermission, type MicPermissionState } from '@/lib/use-mic-permission';
import { voiceDowngrade } from '@/lib/voice/downgrade';

export type VoiceConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'lost';

/** Local-only beat — never the sync value. `resolveAvatarState` still wins on 'settled'. */
export type VoiceBeat = 'listening' | 'speaking' | 'acknowledging' | null;

/** Spec Open question 2: a guess until heard, which is why the manual stop is always visible. */
export const VAD_SILENCE_MS = 2_000;
export const VAD_THRESHOLD = 0.05;

/** The server's question, and the only thing that starts a turn. */
export interface VoiceTurn {
  index: number;
  questionId: string;
}

export interface UseVoiceSessionResult {
  status: VoiceConnectionStatus;
  beat: VoiceBeat;
  /** 0..1 RMS of the candidate's own mic, for the meter. Pinned to 0 while muted. */
  micLevel: number;
  muted: boolean;
  micState: MicPermissionState;
  toggleMute: () => void;
  reconnect: () => void;
  /** The recorder is capturing this turn's answer. */
  recording: boolean;
  /** End the turn now — the manual twin of the VAD, and always offered. */
  stop: () => void;
  /** The failure code for this turn, or null. Copy is S10's; the branch is this hook's. */
  error: string | null;
  /** Re-run whichever half failed: the question audio, or the recording. */
  retry: () => void;
}

export interface UseVoiceSessionOptions {
  /** Voice mode only — a text interview must not open a mic. */
  enabled?: boolean;
  /** Null while the server has no question to speak (waiting, paused, report). */
  turn?: VoiceTurn | null;
  vad?: { silenceMs?: number; threshold?: number };
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

type Phase = 'idle' | 'speaking' | 'listening' | 'uploading' | 'failed';

const BEAT_BY_PHASE: Record<Phase, VoiceBeat> = {
  idle: null,
  speaking: 'speaking',
  listening: 'listening',
  uploading: 'acknowledging',
  failed: null,
};

/** The client is behind the server; the refetch is the whole fix and the candidate sees none of it. */
const SILENT = new Set(['QUESTION_NOT_CURRENT', 'INVALID_STATE_TRANSITION', 'BUDGET_EXCEEDED']);

/** The server already ended or downgraded the interview — the refetch is what renders that. */
const SERVER_ENDED = new Set(['VOICE_SESSION_EXPIRED', 'VOICE_UNAVAILABLE']);

export function useVoiceSession(
  interviewId: string | null,
  options: UseVoiceSessionOptions = {},
): UseVoiceSessionResult {
  const { enabled = true, turn = null, vad } = options;
  const silenceMs = vad?.silenceMs ?? VAD_SILENCE_MS;
  const threshold = vad?.threshold ?? VAD_THRESHOLD;

  const mic = useMicPermission();
  const client = useQueryClient();
  const submitAudio = useSubmitAudioAnswer(interviewId ?? '');

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const { request: requestMic } = mic;
  const active = enabled && Boolean(interviewId);

  const liveRef = useRef(true);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const srcRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const spokenRef = useRef<string | null>(null);
  // Which half to re-run on retry: the question audio, or only the recording.
  const failedAtRef = useRef<'speak' | 'answer'>('speak');
  // The VAD only arms once the candidate has been heard — a turn that opens on silence would
  // otherwise upload two seconds of nothing and come back SPEECH_AUDIO_INVALID.
  const heardRef = useRef(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (active) requestMic();
  }, [active, requestMic]);

  // Re-asking for the mic is the whole retry now — there is no connection to re-establish.
  const reconnect = useCallback(() => requestMic(), [requestMic]);

  const refetchState = useCallback(() => {
    if (!interviewId) return;
    void client.invalidateQueries({ queryKey: queryKeys.interviewState(interviewId) });
  }, [client, interviewId]);

  const releasePlayer = useCallback(() => {
    playerRef.current?.pause();
    playerRef.current = null;
    if (srcRef.current) URL.revokeObjectURL(srcRef.current);
    srcRef.current = null;
  }, []);

  const startRecording = useCallback(() => {
    const stream = mic.stream;
    if (!stream || typeof MediaRecorder === 'undefined') {
      failedAtRef.current = 'answer';
      setError('UNKNOWN');
      setPhase('failed');
      return;
    }

    heardRef.current = false;
    chunksRef.current = [];
    const questionId = spokenRef.current;
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data?.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      recorderRef.current = null;
      // Unmounted mid-turn: the bytes are dropped rather than uploaded into a room nobody is in.
      if (!liveRef.current || !questionId) return;
      const audio = new Blob(chunksRef.current, { type: recorder.mimeType });
      chunksRef.current = [];
      setPhase('uploading');
      submitAudio
        .mutateAsync({ questionId, audio })
        .then(() => {
          if (!liveRef.current) return;
          // The next question arrives as a new `turn` off the refetch the mutation triggers.
          setPhase('idle');
        })
        .catch((err: unknown) => {
          if (!liveRef.current) return;
          const code = err instanceof ApiError ? err.code : 'UNKNOWN';
          if (SILENT.has(code)) {
            setPhase('idle');
            return;
          }
          if (SERVER_ENDED.has(code)) refetchState();
          failedAtRef.current = 'answer';
          setError(code);
          setPhase('failed');
        });
    };

    recorder.start();
    if (mic.muted) recorder.pause();
    setPhase('listening');
  }, [mic.stream, mic.muted, refetchState, submitAudio]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    // A paused recorder ignores `stop` in some browsers; resume first so the last chunk lands.
    if (recorder.state === 'paused') recorder.resume();
    recorder.stop();
  }, []);

  // The question: fetched from our origin, played once, then the mic opens. Nothing here is
  // retried on its own — a question the candidate cannot hear is a downgrade, not a loop.
  useEffect(() => {
    if (!active || !turn || mic.state !== 'granted') return;
    if (spokenRef.current === turn.questionId) return;

    spokenRef.current = turn.questionId;
    let cancelled = false;
    setError(null);
    setPhase('speaking');

    void (async () => {
      const result = await apiGetBlob(
        `/interviews/${interviewId}/questions/${turn.index}/speech`,
      );
      if (cancelled || !liveRef.current) return;

      if (!result.ok || !result.data) {
        const code = result.code ?? 'UNKNOWN';
        if (SILENT.has(code)) {
          setPhase('idle');
          refetchState();
          return;
        }
        if (SERVER_ENDED.has(code)) refetchState();
        failedAtRef.current = 'speak';
        setError(code);
        setPhase('failed');
        return;
      }

      const src = URL.createObjectURL(result.data);
      srcRef.current = src;
      const player = new Audio(src);
      playerRef.current = player;

      player.addEventListener('ended', () => {
        if (!liveRef.current) return;
        releasePlayer();
        startRecording();
      });
      // ADR-S06 §Downgrade: undecodable audio is a fatal voice failure, and the interview
      // continues in text at the same index rather than stalling on a question nobody heard.
      player.addEventListener('error', () => {
        if (!liveRef.current) return;
        releasePlayer();
        setPhase('idle');
        void voiceDowngrade(String(interviewId)).finally(refetchState);
      });

      player.play().catch(() => {
        if (!liveRef.current) return;
        releasePlayer();
        setPhase('idle');
        void voiceDowngrade(String(interviewId)).finally(refetchState);
      });
    })();

    return () => {
      cancelled = true;
    };
    // `attempt` re-runs a failed question; `turn.questionId` is what makes the next one run.
  }, [
    active,
    interviewId,
    mic.state,
    turn,
    attempt,
    refetchState,
    releasePlayer,
    startRecording,
  ]);

  // VAD (ADR-S06): the candidate ends the turn, the server ends the interview. Re-armed by
  // every level change, so a pause that ends before the window closes never fires.
  useEffect(() => {
    if (phase !== 'listening' || mic.muted) return;
    if (mic.level >= threshold) {
      heardRef.current = true;
      return;
    }
    if (!heardRef.current) return;
    const timer = setTimeout(stop, silenceMs);
    return () => clearTimeout(timer);
  }, [phase, mic.level, mic.muted, silenceMs, threshold, stop]);

  // Mute means mute: the recorder stops capturing, it does not merely meter zero.
  useEffect(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (mic.muted && recorder.state === 'recording') recorder.pause();
    if (!mic.muted && recorder.state === 'paused') recorder.resume();
  }, [mic.muted]);

  // A mic lost mid-turn cannot finish the recording it started; the room's lost banner and its
  // reconnect are the next action (S07 owns the denial downgrade).
  useEffect(() => {
    if (mic.state === 'granted' || phase !== 'listening') return;
    stop();
  }, [mic.state, phase, stop]);

  const retry = useCallback(() => {
    setError(null);
    if (failedAtRef.current === 'answer') {
      startRecording();
      return;
    }
    // Re-speak: the question audio is served from the TTS cache, so this does not re-buy it.
    spokenRef.current = null;
    setAttempt((n) => n + 1);
  }, [startRecording]);

  // No hot mic, no orphan playback, no recorder left running once the candidate leaves.
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      recorderRef.current?.stop();
      recorderRef.current = null;
      releasePlayer();
    };
  }, [releasePlayer]);

  return {
    status: STATUS_BY_MIC[mic.state],
    beat: BEAT_BY_PHASE[phase],
    micLevel: mic.muted ? 0 : mic.level,
    muted: mic.muted,
    micState: mic.state,
    toggleMute: mic.toggleMute,
    reconnect,
    recording: phase === 'listening',
    stop,
    error,
    retry,
  };
}
