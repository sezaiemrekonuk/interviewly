'use client';

import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { AvatarPreload } from '../../../../components/avatar';
import { AnswerComposer } from '../../../../components/room/answer-composer';
import { PersonaTiles } from '../../../../components/room/persona-tiles';
import { QuestionPanel } from '../../../../components/room/question-panel';
import { RoomRail } from '../../../../components/room/room-rail';
import { DEFAULT_LANDING_PATH } from '../../../../lib/auth-redirect';
import { Transcript } from '../../../../components/room/transcript';
import { VoiceControls } from '../../../../components/room/voice-controls';
import { SplitShell, WorkTop } from '../../../../components/shell/split-shell';
import { Button } from '../../../../components/ui';
import { routeForError } from '../../../../lib/error-routing';
import { ApiError, useInterviewState, useResumeInterview, useSubmitAnswer } from '../../../../lib/query';
import { resolveAvatarState, roomPhase } from '../../../../lib/room-avatar';
import { useErrorMessage } from '../../../../lib/use-error-message';
import { useInterviewEvents } from '../../../../lib/use-interview-events';
import { useRequireAuth } from '../../../../lib/use-require-auth';
import { useVoiceSession } from '../../../../lib/use-voice-session';

import styles from '../../../../components/room/room.module.css';

/** Past the last answer: the report surface (W07) owns the wait and the result. */
const REPORT_STATES = new Set(['evaluating', 'completed', 'failed', 'abandoned']);

/**
 * How long the waiting panel is the truth before it becomes a lie. A failed HR generation can
 * leave the interview in `hr_round` with no batch (the pause that would have said so is itself
 * a write that can fail), and `GET /state` reports that as `currentQuestion: null` — the same
 * shape as a batch still being generated, because `POST /profile` claims the transition before
 * it calls the model and the SSE nudge arrives with it.
 *
 * ponytail: a timer, because nothing on the wire distinguishes the two. A generation-in-flight
 * flag on `GET /state` would; add it if this number ever has to be tuned rather than picked.
 */
const STALLED_AFTER_MS = 30_000;

export default function InterviewRoomPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('room');
  const errorMessage = useErrorMessage();
  const { user, loading: authLoading } = useRequireAuth();

  const ready = !authLoading && Boolean(user);
  const stateQuery = useInterviewState(ready ? id : null);
  // K11 — the event is a nudge; it invalidates the state key and nothing here reads its body.
  useInterviewEvents(ready ? id : null);

  const submit = useSubmitAnswer(id);
  const resume = useResumeInterview(id);
  const [typedFor, setTypedFor] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);

  // Room chrome, none of it server state: the speaker/grid view, the captions, and whether the
  // transcript panel is out. `null` is "the candidate has not said" — the default differs by
  // mode and `room` is not loaded yet on the first render.
  const [view, setView] = useState<'speaker' | 'grid'>('speaker');
  const [captionsOn, setCaptionsOn] = useState(true);
  const [transcriptOpen, setTranscriptOpen] = useState<boolean | null>(null);

  const room = stateQuery.data;
  const pathname = `/interviews/${id}/room`;
  const queryErrorCode = stateQuery.error?.code ?? null;
  const roomState = room?.state ?? null;

  // `mode` is the server's, so a fatal voice error (V03 downgrade) lands here as a plain
  // refetch and the room becomes the text room — there is no client-side mode flag to unset.
  const voiceMode = room?.mode === 'voice';
  const voice = useVoiceSession(id, { enabled: voiceMode });

  // Navigation belongs in an effect: routing during render is what makes a redirect fire twice.
  useEffect(() => {
    if (queryErrorCode) routeForError(queryErrorCode, router, { pathname });
  }, [queryErrorCode, router, pathname]);

  useEffect(() => {
    if (roomState && REPORT_STATES.has(roomState)) router.replace(`/interviews/${id}`);
  }, [roomState, router, id]);

  // `POST /resume` repairs exactly two rooms with no question: an `hr_round` whose batch never
  // landed, and one still parked in `profiling` (history's Continue link, or a setup that died
  // before `POST /profile`). Offering the control anywhere else would answer the candidate
  // with a 409.
  const waitingOnHr =
    (roomState === 'hr_round' || roomState === 'profiling') &&
    Boolean(room) &&
    !room?.currentQuestion;
  // A parked room is not slow, it is stopped — nothing is generating and nothing will, so the
  // repair fires on arrival instead of after the stall timer. `resume.isIdle` is the once-only
  // guard: the retry it turns into on failure is the candidate's, not a loop.
  const parked = roomState === 'profiling';
  const { mutate: startRoom, isIdle: repairIdle } = resume;
  // Which wait ran out, not whether one did: the flag is never reset, it simply stops matching
  // once the round moves on (`current_index` only ever advances), so every later wait starts
  // its own clock without an effect that writes state on the way back down.
  const waitingIndex = room?.currentIndex ?? null;
  const [stalledIndex, setStalledIndex] = useState<number | null>(null);
  useEffect(() => {
    if (!parked || !repairIdle) return;
    // A repair that comes back with an error is a room nothing will fill on its own — the
    // provider is down (`AI_PROVIDER_UNAVAILABLE`, and `profiling` has no `paused` edge to
    // land in), so waiting out the stall timer only delays the same alert and Retry by 30s.
    startRoom(undefined, { onError: () => setStalledIndex(waitingIndex) });
  }, [parked, repairIdle, startRoom, waitingIndex]);
useEffect(() => {
  if (!waitingOnHr) return;
  if (stalledIndex !== null && stalledIndex === waitingIndex) return;
  const timer = setTimeout(() => setStalledIndex(waitingIndex), STALLED_AFTER_MS);
  return () => clearTimeout(timer);
}, [waitingOnHr, waitingIndex, stalledIndex]);
  const stalled = waitingOnHr && stalledIndex !== null && stalledIndex === waitingIndex;

  if (!ready || stateQuery.isPending) {
    return <div className={styles.skeleton} data-testid="room-skeleton" />;
  }

  if (queryErrorCode) {
    return (
      <main className={styles.room}>
        <div className={styles.errorCard}>
          <p role="alert" className={styles.error}>
            {errorMessage(queryErrorCode)}
          </p>
        </div>
      </main>
    );
  }

  if (!room) return null;

  const phase = roomPhase({
    state: room.state,
    question: room.currentQuestion,
    typedFor,
    submitting: submit.isPending,
  });
  const serverAvatarState = room.persona?.avatarState ?? 'idle';
  // §3.8 holds in both modes — the server value is the sync on every refetch, something local
  // drives it in between. Text uses the typing/submit lifecycle; voice uses the audio beat,
  // which is why `beat: null` falls back to the same `settled` resolution and not to `idle`.
  // With no camera in the room this is what moves the speaker's waveform.
  const avatarState = voiceMode
    ? (voice.beat ?? resolveAvatarState('settled', serverAvatarState))
    : resolveAvatarState(phase, serverAvatarState);

  // A meeting does not open with a document on screen; a written Q&A keeps its record out.
  const showTranscript = transcriptOpen ?? !voiceMode;
  const speaker = room.persona?.name ?? null;

  async function handleSubmit(transcript: string): Promise<boolean> {
    if (!room?.currentQuestion) return false;
    setSubmitError(null);
    try {
      await submit.mutateAsync({
        questionId: room.currentQuestion.id,
        transcript,
        inputMode: 'text',
      });
      return true;
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'UNKNOWN';
      // `refetch` (QUESTION_NOT_CURRENT and friends) is silent by contract: the mutation
      // already invalidated state and the room re-renders from the server's truth. K2 — the
      // client never advances its own index, so there is nothing to tell the candidate.
      if (routeForError(code, router, { pathname }) === 'inline') {
        setSubmitError(errorMessage(code));
      }
      return false;
    }
  }

  const tiles = (
    <>
      <PersonaTiles
        personas={room.personas}
        activeId={room.persona?.id ?? null}
        activeState={avatarState}
        layout={voiceMode ? 'stage' : 'strip'}
        candidate={voiceMode ? { level: voice.micLevel, muted: voice.muted } : null}
      />

      {/* The waiting beat is where both sets are warmed — the handover must not fetch. */}
      {room.currentQuestion ? null : (
        <AvatarPreload sets={room.personas.map((persona) => persona.avatarSet)} />
      )}
    </>
  );

  // The waiting panel is the truth right up until it is not — past `STALLED_AFTER_MS` it
  // would keep promising a question that no longer has anything generating it.
  const question = stalled ? null : (
    // One question, one instance: the panel's typed state resets by remount, not by effect.
    <QuestionPanel
      key={room.currentQuestion?.id ?? 'waiting'}
      question={room.currentQuestion}
      onTyped={setTypedFor}
      instant={voiceMode}
      speaker={speaker ?? undefined}
      className={voiceMode ? styles.caps : styles.writtenSheet}
    />
  );

  // Both doors out of a round the candidate cannot answer from lead to the same request:
  // `POST /resume` resumes a pause, and regenerates the batch when there is none.
  const notice =
    room.state === 'paused' || stalled ? (
      <div
        className={stalled ? `${styles.notice} ${styles.noticeDanger}` : styles.notice}
        data-testid={stalled ? 'room-stalled' : 'room-paused'}
      >
        <p
          className={stalled ? styles.error : styles.noticeText}
          role={stalled ? 'alert' : undefined}
        >
          {stalled ? t('stalled') : t('paused')}
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setResumeError(null);
            resume.mutate(undefined, {
              onError: (err) => setResumeError(errorMessage(err.code)),
            });
          }}
          loading={resume.isPending}
        >
          {stalled ? t('retry') : t('resume')}
        </Button>
        {resumeError ? (
          <p role="alert" className={styles.error}>
            {resumeError}
          </p>
        ) : null}
      </div>
    ) : null;

  return (
    <div className={styles.room} data-testid="interview-room">
      <SplitShell
        width="default"
        rail={
          <RoomRail
            room={room}
            voiceStatus={voiceMode ? voice.status : null}
            onLeave={() => router.push(DEFAULT_LANDING_PATH)}
          />
        }
      >
        <WorkTop title={speaker ? t('hasFloor', { name: speaker }) : t('roomTitle')}>
          {voiceMode ? (
            <div className={styles.seg} role="group" aria-label={t('viewLabel')}>
              <button
                type="button"
                className={styles.segButton}
                aria-pressed={view === 'speaker'}
                onClick={() => setView('speaker')}
              >
                {t('viewSpeaker')}
              </button>
              <button
                type="button"
                className={styles.segButton}
                aria-pressed={view === 'grid'}
                onClick={() => setView('grid')}
              >
                {t('viewGrid')}
              </button>
            </div>
          ) : null}
        </WorkTop>

        <div className={styles.workGrid} data-transcript={showTranscript ? 'open' : 'closed'}>
          {voiceMode ? (
            <section className={styles.stage} data-view={view}>
              {tiles}

              {/* Captions and the control bar share a grid row of their own: floated over the
                  stage the bar would land on the captions the moment it wrapped. */}
              <div className={styles.footRow}>
                {captionsOn ? question : null}
                {notice}
                {room.state !== 'paused' && !stalled ? (
                  <VoiceControls
                    session={voice}
                    captionsOn={captionsOn}
                    onToggleCaptions={() => setCaptionsOn((on) => !on)}
                    transcriptOpen={showTranscript}
                    onToggleTranscript={() => setTranscriptOpen(!showTranscript)}
                  />
                ) : null}
              </div>
            </section>
          ) : (
            // Text is not this room with the audio off: a written Q&A on the light surface,
            // the roster reduced to a strip, no stage and no controls.
            <div className={styles.written}>
              {tiles}
              {question}
              {notice}
              {room.currentQuestion && room.state !== 'paused' ? (
                <AnswerComposer
                  onSubmit={handleSubmit}
                  pending={submit.isPending}
                  error={submitError}
                />
              ) : null}
            </div>
          )}

          <Transcript turns={room.transcript} live={voiceMode} open={showTranscript} />
        </div>
      </SplitShell>
    </div>
  );
}
