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

import { API_BASE, apiGetBlob } from '@/lib/api';
import {
  queryKeys,
  useSubmitAudioTurn,
  useSubmitTurn,
  ApiError,
  type RoomMessage,
} from '@/lib/query';
import {
  useMicPermission,
  type MicDevice,
  type MicPermissionState,
} from '@/lib/use-mic-permission';
import { voiceDowngrade } from '@/lib/voice/downgrade';
import { markFlushed } from '@/lib/voice/unload-flush';

export type VoiceConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'lost';

/** Local-only beat — never the sync value. `resolveAvatarState` still wins on 'settled'. */
export type VoiceBeat = 'listening' | 'speaking' | 'acknowledging' | null;

/**
 * Spec Open question 2: a guess until heard, which is why the manual stop is always visible.
 *
 * Since T04 this window ends a RECORDING, not a turn — the server's completeness gate decides
 * whether the utterance was finished. So it is short on purpose: it costs a round trip when the
 * candidate is mid-thought, and a long one is latency on every answer they did finish.
 */
export const VAD_SILENCE_MS = 2_000;

/**
 * The CEILING on what counts as speech, not the test for it (ADR-T07). 0.05 RMS is a loud voice
 * on a close microphone; a laptop mic at arm's length runs an order of magnitude quieter, and
 * against a fixed 0.05 such a candidate is never heard at all — no probe is ever sent, and the
 * only thing that ends their turn is the clock. That cost four live interviews.
 */
export const VAD_THRESHOLD = 0.05;

/**
 * How far above the room's own noise floor a frame has to sit to be somebody talking. Three
 * times is the usual margin: room tone is steady, speech is not, and the gap between them is
 * far larger than this on any real microphone.
 */
const SPEECH_OVER_FLOOR = 3;

/**
 * ...and the quietest thing that may ever count as speech, whatever the floor says. Without it a
 * dead-silent room (floor ~0) would arm on its own dither. -40 dBFS.
 */
const VAD_FLOOR = 0.01;

/**
 * T04 — how long a turn may say nothing at all before the room tells the server so. The room
 * asserts nothing by sending it (K11): "the window has passed" is the whole message, and whether
 * that is a real silence or a flush of what is already held is the server's call.
 *
 * Six seconds since ADR-T08, down from thirteen. ADR-T06 defended the longer number as a
 * thinking budget and the owner overruled it from the room: thirteen seconds of an interviewer
 * saying nothing reads as a room that has stopped working, and a candidate who is genuinely
 * thinking is better served by an interviewer that speaks than by one that waits.
 */
export const FORCE_SUBMIT_MS = 6_000;

/**
 * ADR-T06 — the same signal, sent sooner, when the server is already holding a fragment. That
 * candidate has spoken, has paused, and has had the gate's verdict; four more seconds of
 * silence buy nothing and is what a wrongly-held finished answer costs. The gate's round trip
 * is inside this window, so the real grace after a verdict is nearer three seconds.
 *
 * The long window stays for the other case, which is not the same case: a candidate who has said
 * nothing at all is thinking about a hard question, and that time is theirs.
 */
export const FLUSH_HELD_MS = 4_000;

/** How often the silence window is checked. Independent of the mic's frame rate on purpose. */
const VAD_POLL_MS = 100;

/**
 * T07 — how often the recorder hands over what it has captured. Without a timeslice a
 * `MediaRecorder` holds everything until `stop()`, so a page torn down mid-sentence has nothing
 * to send: the bytes exist only inside a recorder that dies with the document. It does not
 * change what a normal turn uploads — the same bytes simply arrive in pieces, and `onstop`
 * assembles the identical blob.
 */
const CHUNK_MS = 1_000;

/**
 * ...and how much of them a beacon may carry. The browser's own limit is 64 KiB across all
 * beacons in flight, and it REFUSES an oversized payload rather than truncating it, so this sits
 * under the ceiling with the multipart envelope's few hundred bytes to spare.
 */
const BEACON_MAX_BYTES = 60_000;

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
  /**
   * The server is holding what has been said so far and is waiting for the rest of it — the
   * candidate paused mid-thought and the turn did not end. Nothing is asserted by it: it is the
   * last upload's answer, and the room only says so out loud.
   */
  holding: boolean;
  /**
   * End the recording now. `'final'` ends the TURN with it — the manual twin of the VAD, always
   * offered, gate never consulted. `'probe'` is the VAD's own stop: the recording ends, the
   * turn does not, and the server decides which of the two it was.
   */
  stop: (reason?: StopReason) => void;
  /** The failure code for this turn, or null. Copy is S10's; the branch is this hook's. */
  error: string | null;
  /** Re-run whichever half failed: the question audio, or the recording. */
  retry: () => void;
  /** The inputs this machine offers, for the room's picker. Empty until permission lands. */
  devices: MicDevice[];
  /** The device backing the live capture, or null if unknown. */
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

/**
 * T04 — why a recording stopped, which is the only thing that separates the two paths through
 * `onstop`. No new PHASE goes with it: a probe keeps `phase === 'listening'`, so the avatar goes
 * on saying *listening* and the bars go on moving, which is the truth — the room is still the
 * candidate's. Only a stop that ends the turn reaches `uploading`.
 */
type StopReason = 'probe' | 'final';

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
  const submitTurn = useSubmitTurn(interviewId ?? '');

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [holding, setHolding] = useState(false);

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
  // The quietest level seen since this recorder opened — this room, this microphone, this turn.
  const floorRef = useRef(VAD_THRESHOLD);
  // When this recorder opened. The silent-turn clock measures from here until something is heard, and
  // from the last loud frame after that.
  const turnStartedRef = useRef(0);
  // Why the recorder stopped, read once in `onstop`.
  const reasonRef = useRef<StopReason>('final');
  // Set on the recorder the room is about to throw away: the one re-opened for a probe whose
  // answer came back conducted, and the one the silence clock closes. Its bytes are dropped
  // rather than uploaded — the interviewer is about to speak, and an open mic records the TTS.
  const discardRef = useRef(false);
  // An upload is in flight. The silent-turn clock must not fire underneath one: a probe keeps the phase
  // on 'listening', so nothing else would stop it.
  const uploadingRef = useRef(false);
  // The silence turn is sent once per open recorder, whatever the interval sees afterwards.
  const silenceSentRef = useRef(false);
  // T07 — the unload flush is sent once per open recorder too. A `pagehide` the page comes back
  // from (a backgrounded tab) can fire again, and the second one has nothing new to say.
  const flushedRef = useRef(false);
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

  // One branch for every way a submission can come back wrong, because both submissions — the
  // recorded turn and the silence turn — owe exactly the same reconciliation.
  const failTurn = useCallback(
    (err: unknown) => {
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
    },
    [refetchState],
  );

  /** Close the open recorder and throw its bytes away. Nothing is uploaded and nothing is lost. */
  const discardRecorder = useCallback(() => {
    const open = recorderRef.current;
    if (!open) return;
    discardRef.current = true;
    recorderRef.current = null;
    if (open.state !== 'inactive') open.stop();
  }, []);

  function startRecording() {
    const stream = mic.stream;
    if (!stream || typeof MediaRecorder === 'undefined') {
      failedAtRef.current = 'answer';
      setError('UNKNOWN');
      setPhase('failed');
      return;
    }

    heardRef.current = false;
    floorRef.current = threshold;
    chunksRef.current = [];
    discardRef.current = false;
    silenceSentRef.current = false;
    flushedRef.current = false;
    turnStartedRef.current = Date.now();
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data?.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      recorderRef.current = null;
      // A recorder the room already replaced or closed. Its bytes were never a turn.
      if (discardRef.current) {
        discardRef.current = false;
        chunksRef.current = [];
        return;
      }
      // Unmounted mid-turn: the bytes are dropped rather than uploaded into a room nobody is in.
      if (!liveRef.current) return;
      const audio = new Blob(chunksRef.current, { type: recorder.mimeType });
      chunksRef.current = [];
      const probe = reasonRef.current === 'probe';
      // BEFORE the upload, never after (T04). The round trip is a second of speech, and a
      // second of speech nobody is recording is the failure this ledger exists to fix, moved
      // one step later — where it is harder to see, because the room still looks right.
      if (probe) startRecording();
      else setPhase('uploading');
      uploadingRef.current = true;
      // No question named: the utterance may not be an answer at all, and what it advances is
      // the conductor's call (C02). The upload is the whole of what this hook asserts.
      submitAudio
        .mutateAsync({ audio, force: !probe })
        .then(({ pendingTurn }) => {
          uploadingRef.current = false;
          if (!liveRef.current) return;
          setHolding(pendingTurn !== null);
          // Still the candidate's turn: the gate called it unfinished, nothing was conducted,
          // and the recorder opened a moment ago is already carrying the rest of the sentence.
          if (pendingTurn !== null) return;
          // Conducted. Close the mic re-opened for the probe — the interviewer's reply arrives
          // as a new assistant message off the refetch, and an open mic would record it.
          discardRecorder();
          setPhase('idle');
        })
        .catch((err: unknown) => {
          uploadingRef.current = false;
          discardRecorder();
          failTurn(err);
        });
    };

    recorder.start(CHUNK_MS);
    if (mic.muted) recorder.pause();
    setPhase('listening');
  }

  // `startRecording` closes over `submitAudio`, and a react-query mutation result is a NEW
  // object on every render. The meter re-renders this hook once per animation frame, so using
  // that callback as an effect dependency below re-runs the speak effect ~60×/s — each run
  // cancelling the in-flight audio and then finding nothing pending (the id was marked spoken
  // before the fetch), so nothing ever plays. Read through a ref instead: the effect reacts to
  // the conversation, not to identity churn.
  // A plain function, not a `useCallback`, since T04 — `onstop` re-opens the recorder by calling
  // it, so memoising it would make it capture the ref that holds it, and a ref reached through
  // the closure a hook memoises may not be assigned to. Its identity was never what the room
  // read anyway: everything below goes through this ref, refreshed on every commit.
  const startRecordingRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    startRecordingRef.current = startRecording;
  });

  const stop = useCallback((reason: StopReason = 'final') => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    reasonRef.current = reason;
    // A paused recorder ignores `stop` in some browsers; resume first so the last chunk lands.
    if (recorder.state === 'paused') recorder.resume();
    recorder.stop();
  }, []);

  // The silence submission goes through `POST /turns`, not the audio route, and reaches it
  // through a ref for the same reason `startRecording` does: a mutation result is a new object
  // every render, and the meter renders this hook once per animation frame.
  const submitTurnRef = useRef(submitTurn);
  useEffect(() => {
    submitTurnRef.current = submitTurn;
  });

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
      startRecordingRef.current?.();
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
    // What this microphone's silence actually measures, learned per recording rather than
    // assumed. It only ever moves DOWN within a turn, and `startRecording` resets it, so a room
    // that gets noisier mid-answer cannot desensitise the rest of that answer.
    const armAt = Math.min(threshold, Math.max(floorRef.current * SPEECH_OVER_FLOOR, VAD_FLOOR));
    if (mic.level < armAt) {
      // A level of exactly zero is not a measurement of the room — it is a microphone that is
      // delivering nothing (muted, suspended, or not yet running). Learning from it would teach
      // the room that silence is 0 and drop the bar to `VAD_FLOOR` for the rest of the turn.
      if (mic.level > 0) floorRef.current = Math.min(floorRef.current, mic.level);
      return;
    }
    heardRef.current = true;
    lastLoudRef.current = Date.now();
  }, [phase, mic.level, mic.muted, threshold]);

  useEffect(() => {
    if (phase !== 'listening' || mic.muted) return;
    const timer = setInterval(() => {
      if (!heardRef.current) return;
      // A probe, not the end of the turn: the server's gate decides whether the candidate had
      // finished, and this window is only how long a pause has to be to be worth asking about.
      if (Date.now() - lastLoudRef.current >= silenceMs) stop('probe');
    }, VAD_POLL_MS);
    return () => clearInterval(timer);
  }, [phase, mic.muted, silenceMs, stop]);

  // The clock (T04, split by ADR-T06). The turn always ends: the VAD only fires once the candidate has been
  // heard, so a turn spoken into in the first place is ended by the gate — and one that is never
  // spoken into at all would otherwise sit open forever, listening to a room nobody is talking
  // in. The room asserts nothing by sending it (K11); the server reads it as a flush of whatever
  // it is holding, or as a real silence, and it is the only one that can tell those apart.
  useEffect(() => {
    if (phase !== 'listening' || mic.muted) return;
    const timer = setInterval(() => {
      if (silenceSentRef.current || uploadingRef.current) return;
      const since = heardRef.current ? lastLoudRef.current : turnStartedRef.current;
      if (Date.now() - since < (holding ? FLUSH_HELD_MS : FORCE_SUBMIT_MS)) return;
      silenceSentRef.current = true;
      // Nothing was said into this recorder, so there is nothing to transcribe and no STT call
      // to pay for: the bytes are dropped rather than uploaded.
      discardRecorder();
      setPhase('uploading');
      uploadingRef.current = true;
      submitTurnRef.current
        .mutateAsync({ kind: 'silence', inputMode: 'voice' })
        .then(() => {
          uploadingRef.current = false;
          if (!liveRef.current) return;
          setHolding(false);
          setPhase('idle');
        })
        .catch((err: unknown) => {
          uploadingRef.current = false;
          failTurn(err);
        });
    }, VAD_POLL_MS);
    return () => clearInterval(timer);
  }, [phase, mic.muted, holding, discardRecorder, failTurn]);

  // T07 — the last thing this room can do for speech that never reached a probe. The candidate
  // is mid-sentence, nothing has been uploaded, and the document is being torn down: a normal
  // `fetch` does not outlive it, so the tail goes out as a beacon and the page is free to die.
  //
  // `pagehide`, not `beforeunload` — the latter never fires on mobile Safari, and a backgrounded
  // tab that is later killed loses exactly as much as a refresh does.
  //
  // Best-effort by construction (ADR-T02): a flush is an ordinary probe, unforced and gated like
  // any other, and nothing above it is told whether it landed. There is no state to update —
  // what the reloaded room shows is what the server actually holds, and the recovery notice
  // already reads that from `GET /state` rather than from anything claimed here.
  useEffect(() => {
    if (phase !== 'listening' || !interviewId) return;
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;

    const flush = () => {
      const recorder = recorderRef.current;
      const chunks = chunksRef.current;
      // Fewer than two chunks is the container header and no audio after it: a refresh in the
      // second before the candidate said anything, with nothing in it to recover and no reason
      // to pay for an STT call.
      if (flushedRef.current || !recorder || chunks.length < 2) return;

      // Chunk 0 is the only one with the WebM header and the codec's init data in it, so it
      // always rides along: a tail of clusters on its own is not a file any decoder will take.
      // Everything else is taken from the END — the words the candidate was in the middle of are
      // the ones worth the room's one remaining request, and the cap is what the oldest speech
      // in a long answer costs.
      const head = chunks[0];
      let budget = BEACON_MAX_BYTES - head.size;
      const tail: Blob[] = [];
      for (let i = chunks.length - 1; i > 0 && chunks[i].size <= budget; i -= 1) {
        budget -= chunks[i].size;
        tail.unshift(chunks[i]);
      }
      if (tail.length === 0) return;

      const type = (recorder.mimeType || 'audio/webm').split(';')[0];
      const form = new FormData();
      form.append('audio', new File([head, ...tail], 'answer', { type }), 'answer');
      // No `force`: the gate decides whether this finished the turn, exactly as for a probe.
      if (!navigator.sendBeacon(`${API_BASE}/interviews/${interviewId}/turns/audio`, form)) return;

      flushedRef.current = true;
      // The note for the page that replaces this one: its `GET /state` will beat the STT and the
      // gate, and without this it would freeze on the honest null they answer with.
      markFlushed(interviewId);
      // The page may yet survive this event, and the recorder with it. What has been sent must
      // not be uploaded a second time and joined onto the same turn twice — but the header stays
      // behind, or the blob `onstop` assembles has no container at all.
      chunksRef.current = [head];
    };

    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [phase, interviewId]);

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
    stop('final');
  }, [mic.state, phase, stop]);

  const retry = useCallback(() => {
    setError(null);
    if (failedAtRef.current === 'answer') {
      startRecordingRef.current?.();
      return;
    }
    // Re-speak just the line that failed: the audio is served from the TTS cache, so this does
    // not re-buy it, and un-speaking the whole conversation would replay it from the greeting.
    if (failedMessageRef.current) spokenRef.current.delete(failedMessageRef.current);
    failedMessageRef.current = null;
    setAttempt((n) => n + 1);
  }, []);

  // No hot mic, no orphan playback, no recorder left running once the candidate leaves.
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      reasonRef.current = 'final';
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
    holding,
    stop,
    error,
    retry,
    devices: mic.devices,
    deviceId: mic.deviceId,
    selectDevice: mic.select,
  };
}
