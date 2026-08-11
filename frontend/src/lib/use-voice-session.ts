// W10, rewritten by S05, given its turn loop by S06, pointed at the conversation by C02. There
// is no realtime socket any more: ADR-S01 replaced the conversation agent with two server-side
// HTTP calls (TTS for what the interviewer says, STT for what the candidate says), so the mint,
// the socket dial and the agent frames it decoded are gone with it.
//
// The loop is still discrete (ADR-S06) and it is now keyed on MESSAGES, not on the question
// index: speak the assistant lines this session has not spoken yet, oldest first, then record,
// stop on silence, upload, refetch. The index was never the right key — the conductor answers
// every utterance with a sentence and only sometimes advances (C02), so a turn that clarifies
// leaves the index exactly where it was and an index-keyed loop hears nothing and says nothing.
// A message id is the stable handle: it survives a refetch and an index does not.
//
// K11 still holds — this hook never advances the room index, never fills the transcript and
// never reads room state. Truth arrives through `GET /interviews/:id/state`, and `messages` is
// that truth handed back down.
'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiGetBlob } from '@/lib/api';
import { queryKeys, useSubmitAudioTurn, ApiError, type RoomMessage } from '@/lib/query';
import {
  useMicPermission,
  type MicDevice,
  type MicPermissionState,
} from '@/lib/use-mic-permission';
import { voiceDowngrade } from '@/lib/voice/downgrade';

export type VoiceConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'lost';

/** Local-only beat — never the sync value. `resolveAvatarState` still wins on 'settled'. */
export type VoiceBeat = 'listening' | 'speaking' | 'acknowledging' | null;

/** Spec Open question 2: a guess until heard, which is why the manual stop is always visible. */
export const VAD_SILENCE_MS = 2_000;
export const VAD_THRESHOLD = 0.05;

/** How often the silence window is checked. Independent of the mic's frame rate on purpose. */
const VAD_POLL_MS = 100;

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
  /** The inputs this machine offers, for the room's picker. Empty until permission lands. */
  devices: MicDevice[];
  /** The device backing the live capture, or null before one is granted. */
  deviceId: string | null;
  /**
   * Switch input mid-interview. Re-requests against the chosen device and releases the old
   * track — which is why the room refuses it while `recording`: the `MediaRecorder` is bound
   * to the stream being replaced, and swapping under it truncates the answer in progress.
   */
  selectDevice: (deviceId: string) => void;
}

export interface UseVoiceSessionOptions {
  /** Voice mode only — a text interview must not open a mic. */
  enabled?: boolean;
  /**
   * `state.messages` as the server returned it, oldest first. Its IDENTITY is not read — the
   * speak effect keys on the assistant ids inside it (see `assistantIds`), because react-query
   * hands back a new array for the same rows on every refetch and the meter re-renders the room
   * once per animation frame. Both used to tear the effect down mid-turn.
   */
  messages?: RoomMessage[];
  /**
   * Whether the interviewer may speak and the mic may open at all — `hr_round || tech_round`.
   * False parks the loop without forgetting what it has already said, which is what a paused
   * room, a report and an ended interview all need.
   */
  speakable?: boolean;
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

/** Module-level so the default is the SAME array every render — see `messages` in the options. */
const NO_MESSAGES: RoomMessage[] = [];

export function useVoiceSession(
  interviewId: string | null,
  options: UseVoiceSessionOptions = {},
): UseVoiceSessionResult {
  const { enabled = true, messages = NO_MESSAGES, speakable = true, vad } = options;
  const silenceMs = vad?.silenceMs ?? VAD_SILENCE_MS;
  const threshold = vad?.threshold ?? VAD_THRESHOLD;

  const mic = useMicPermission();
  const client = useQueryClient();
  const submitAudio = useSubmitAudioTurn(interviewId ?? '');

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const { request: requestMic } = mic;
  const active = enabled && Boolean(interviewId);

  const liveRef = useRef(true);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const srcRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Every assistant message this session has already played, by id. A Set of ids and not a
  // high-water index: `messages` is refetched whole after every turn and a position in it means
  // nothing across two fetches, while an id means the same line in both.
  const spokenRef = useRef<Set<string>>(new Set());
  // Whether the backlog has been written off yet — see the seeding block in the speak effect.
  const seededRef = useRef(false);
  // Which half to re-run on retry: the interviewer's audio, or only the recording.
  const failedAtRef = useRef<'speak' | 'answer'>('speak');
  // The message whose audio failed, so a retry can un-speak exactly that one.
  const failedMessageRef = useRef<string | null>(null);
  // The VAD only arms once the candidate has been heard — a turn that opens on silence would
  // otherwise upload two seconds of nothing and come back SPEECH_AUDIO_INVALID.
  const heardRef = useRef(false);
  const lastLoudRef = useRef(0);
  const [attempt, setAttempt] = useState(0);

  // What the speak effect actually reacts to: WHICH assistant lines exist, by id, in order.
  //
  // Not `messages` itself. react-query returns a new array for the same rows on every refetch,
  // and `useInterviewEvents` invalidates the state query on every SSE INTERVIEW_STATE_CHANGED —
  // which `applyTransition` publishes mid-request, so a handover or an interview ending reliably
  // produces one, and an EventSource reconnect produces another. With the array as the
  // dependency, such a refetch lands mid-playback, the cleanup cancels the in-flight turn, and
  // the re-run finds nothing pending (ids are marked spoken BEFORE their fetch, deliberately —
  // see the loop below), so `startRecordingRef` is never reached: `phase` sticks on 'speaking'
  // forever, `retry` only renders on 'failed', and the candidate's mic never opens again.
  //
  // A string of ids is stable by VALUE, so neither a refetch of unchanged rows nor the meter's
  // ~60 renders/s re-enters the effect, and the one thing that must re-enter it — the server
  // writing a new assistant line — changes it. Do NOT "simplify" this back to `messages`.
  const assistantIds = messages
    .filter((m) => m.role === 'assistant')
    .map((m) => m.id)
    .join('|');

  // The rows themselves are then read through a ref, so the effect sees the latest ones without
  // depending on the array. Declared above the speak effect so this commit's value is in place
  // before that effect runs — the same ordering trick as `startRecordingRef` below.
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data?.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      recorderRef.current = null;
      // Unmounted mid-turn: the bytes are dropped rather than uploaded into a room nobody is in.
      if (!liveRef.current) return;
      const audio = new Blob(chunksRef.current, { type: recorder.mimeType });
      chunksRef.current = [];
      setPhase('uploading');
      // No question named: the utterance may not be an answer at all, and what it advances is
      // the conductor's call (C02). The upload is the whole of what this hook asserts.
      submitAudio
        .mutateAsync({ audio })
        .then(() => {
          if (!liveRef.current) return;
          // The interviewer's reply arrives as a new assistant message off the refetch the
          // mutation triggers, and the speak effect picks it up from there.
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

  // `startRecording` closes over `submitAudio`, and a react-query mutation result is a NEW
  // object on every render. The meter re-renders this hook once per animation frame, so using
  // that callback as an effect dependency below re-runs the speak effect ~60×/s — each run
  // cancelling the in-flight audio and then finding nothing pending (the id was marked spoken
  // before the fetch), so nothing ever plays. Read through a ref instead: the effect reacts to
  // the conversation, not to identity churn.
  const startRecordingRef = useRef(startRecording);
  useEffect(() => {
    startRecordingRef.current = startRecording;
  }, [startRecording]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    // A paused recorder ignores `stop` in some browsers; resume first so the last chunk lands.
    if (recorder.state === 'paused') recorder.resume();
    recorder.stop();
  }, []);

  // The interviewer's side of the conversation: every assistant line not yet spoken, in order,
  // each fetched from our origin and played once, and then the mic opens. A single turn can
  // produce more than one — a handover writes the outgoing interviewer's closing line and then
  // the incoming one's greeting (`conductor.ts` `handover`) — so this is a queue, not one file,
  // and the recorder must not open until the last of them has finished playing.
  //
  // Nothing here is retried on its own: a line the candidate cannot hear is a downgrade, not a
  // loop (ADR-S06 §Downgrade).
  useEffect(() => {
    if (!active || !speakable || mic.state !== 'granted') return;

    // The backlog, written off once per mounted session. Without this a refresh mid-interview
    // finds every assistant line unspoken and reads the whole interview back at the candidate
    // from the greeting — §3.8 says the room REBUILDS from `messages`, not that it re-runs
    // them. What survives the write-off is the trailing run of assistant lines after the last
    // candidate utterance, which is exactly the prompt they are currently being asked and the
    // one thing a reload does have to replay.
    const rows = messagesRef.current;
    if (!seededRef.current && rows.length > 0) {
      seededRef.current = true;
      const lastSaid = rows.map((m) => m.role).lastIndexOf('user');
      rows.slice(0, lastSaid + 1).forEach((m) => spokenRef.current.add(m.id));
    }

    const pending = rows.filter(
      (m) => m.role === 'assistant' && !spokenRef.current.has(m.id),
    );
    if (pending.length === 0) return;

    let cancelled = false;
    setError(null);
    setPhase('speaking');

    /** Resolves true when the line has been heard to the end; false on any branch that stops. */
    const speak = async (messageId: string): Promise<boolean> => {
      const result = await apiGetBlob(`/interviews/${interviewId}/messages/${messageId}/speech`);
      if (cancelled || !liveRef.current) return false;

      if (!result.ok || !result.data) {
        const code = result.code ?? 'UNKNOWN';
        if (SILENT.has(code)) {
          setPhase('idle');
          refetchState();
          return false;
        }
        if (SERVER_ENDED.has(code)) refetchState();
        failedAtRef.current = 'speak';
        failedMessageRef.current = messageId;
        setError(code);
        setPhase('failed');
        return false;
      }

      const src = URL.createObjectURL(result.data);
      srcRef.current = src;
      const player = new Audio(src);
      playerRef.current = player;

      return new Promise<boolean>((resolve) => {
        player.addEventListener('ended', () => {
          if (!liveRef.current) return resolve(false);
          releasePlayer();
          resolve(true);
        });
        // Undecodable or blocked audio is a fatal voice failure, and the interview continues in
        // text on the same turn rather than stalling on a line nobody heard.
        const downgrade = () => {
          if (!liveRef.current) return resolve(false);
          releasePlayer();
          setPhase('idle');
          void voiceDowngrade(String(interviewId)).finally(refetchState);
          resolve(false);
        };
        player.addEventListener('error', downgrade);
        player.play().catch(downgrade);
      });
    };

    void (async () => {
      for (const message of pending) {
        // Marked before the fetch, never after. The meter re-renders this hook ~60×/s and every
        // one of those renders re-derives `pending`; an id marked only once its audio arrived
        // would be re-requested by each of them.
        spokenRef.current.add(message.id);
        if (!(await speak(message.id))) return;
        if (cancelled || !liveRef.current) return;
      }
      startRecordingRef.current();
    })();

    return () => {
      cancelled = true;
      // A turn that is torn down still owns an `Audio` on an object URL. Left alone it keeps
      // playing over whatever the next run says and its blob is never revoked, so release it
      // here rather than only on 'ended' and on unmount.
      releasePlayer();
    };
    // `attempt` re-runs a failed line; `assistantIds` re-runs when the server writes a new one.
  }, [active, speakable, interviewId, mic.state, assistantIds, attempt, refetchState, releasePlayer]);

  // VAD (ADR-S06): the candidate ends the turn, the server ends the interview.
  //
  // The silence window is measured from a timestamp, NOT held in a timer keyed to the level.
  // `mic.level` changes once per animation frame, and a `setTimeout` in an effect that depends
  // on it is torn down and re-armed by every one of those frames — it can only elapse if the
  // reported RMS is bit-identical for the whole window, which no real microphone's noise floor
  // ever is. The recorder then never stops and the turn never uploads.
  useEffect(() => {
    if (phase !== 'listening' || mic.muted) return;
    if (mic.level < threshold) return;
    heardRef.current = true;
    lastLoudRef.current = Date.now();
  }, [phase, mic.level, mic.muted, threshold]);

  useEffect(() => {
    if (phase !== 'listening' || mic.muted) return;
    const timer = setInterval(() => {
      if (!heardRef.current) return;
      if (Date.now() - lastLoudRef.current >= silenceMs) stop();
    }, VAD_POLL_MS);
    return () => clearInterval(timer);
  }, [phase, mic.muted, silenceMs, stop]);

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
    // Re-speak just the line that failed: the audio is served from the TTS cache, so this does
    // not re-buy it, and un-speaking the whole conversation would replay it from the greeting.
    if (failedMessageRef.current) spokenRef.current.delete(failedMessageRef.current);
    failedMessageRef.current = null;
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
    devices: mic.devices,
    deviceId: mic.deviceId,
    selectDevice: mic.select,
  };
}
