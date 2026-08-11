'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';

import { AnswerComposer } from '../../../../../components/room/answer-composer';
import { Conversation } from '../../../../../components/room/conversation';
import { PersonaTiles } from '../../../../../components/room/persona-tiles';
import { QuestionPanel } from '../../../../../components/room/question-panel';
import { RoomRail } from '../../../../../components/room/room-rail';
import { useRouter } from '../../../../../i18n/navigation';
import { DEFAULT_LANDING_PATH } from '../../../../../lib/auth-redirect';
import { VoiceControls } from '../../../../../components/room/voice-controls';
import { SplitShell, WorkTop } from '../../../../../components/shell/split-shell';
import { Button } from '../../../../../components/ui';
import { routeForError } from '../../../../../lib/error-routing';
import { ApiError, useInterviewState, useResumeInterview, useSubmitTurn } from '../../../../../lib/query';
import { resolveAvatarState, roomPhase } from '../../../../../lib/room-avatar';
import { useErrorMessage } from '../../../../../lib/use-error-message';
import { useInterviewEvents } from '../../../../../lib/use-interview-events';
import { useRequireAuth } from '../../../../../lib/use-require-auth';
import { useRoomHeartbeat } from '../../../../../lib/use-room-clock';
import { useVoiceSession } from '../../../../../lib/use-voice-session';
import { resolveActiveSpeaker } from '../../../../../lib/voice/active-speaker';

import styles from '../../../../../components/room/room.module.css';

/** Past the last answer: the report surface (W07) owns the wait and the result. */
const REPORT_STATES = new Set(['evaluating', 'completed', 'failed', 'abandoned']);

/**
 * Entered before the interview was ever started — history's Continue link, or a setup that
 * died. No question, and nothing generating one: these rooms are stopped, not slow (#89).
 */
const PARKED_STATES = new Set(['created', 'profiling']);

/** The two states a question can arrive in on its own, so the two a wait can be honest in. */
const ROUND_STATES = new Set(['hr_round', 'tech_round']);

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

  const submit = useSubmitTurn(id);
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
  const speakable = roomState === 'hr_round' || roomState === 'tech_round';

  // I16 — presence, on a timer, for as long as this room is a room. Gated on the state rather
  // than on the component being mounted because the room stays mounted for a beat after the last
  // answer while the redirect to the report runs, and time banked there is time nobody sat.
  useRoomHeartbeat(id, ready && roomState !== null && !REPORT_STATES.has(roomState));
  // C06 — voice follows the conversation, not the question index: the welcome, a follow-up and
  // the handover line are all things to say and none of them is a question.
  //
  // `room.messages` is passed through exactly as react-query hands it over. It is an effect
  // dependency inside the hook, and a `.filter()` or a spread here would mint a fresh array on
  // every render — the mic meter re-renders this room ~60x/s, which would tear the speak effect
  // down mid-fetch and, because an id is marked spoken before its fetch, nothing would ever play.
  const voice = useVoiceSession(id, { enabled: voiceMode, messages: room?.messages, speakable });

  // Navigation belongs in an effect: routing during render is what makes a redirect fire twice.
  useEffect(() => {
    if (queryErrorCode) routeForError(queryErrorCode, router, { pathname });
  }, [queryErrorCode, router, pathname]);

  useEffect(() => {
    if (roomState && REPORT_STATES.has(roomState)) router.replace(`/interviews/${id}`);
  }, [roomState, router, id]);

  // `POST /resume` repairs every room with no question and nothing on its way: a round whose
  // batch never landed — either round, since a pause that could not be written leaves the
  // technical one just as empty — and one entered before the interview was started at all.
  // Offering the control anywhere else would answer the candidate with a 409.
  const waitingOnQuestion =
    Boolean(room) &&
    !room?.currentQuestion &&
    roomState !== null &&
    (PARKED_STATES.has(roomState) || ROUND_STATES.has(roomState));
  // A parked room is not slow, it is stopped — nothing is generating and nothing will, so the
  // repair fires on arrival instead of after the stall timer. `resume.isIdle` is the once-only
  // guard: the retry it turns into on failure is the candidate's, not a loop.
  const parked = roomState !== null && PARKED_STATES.has(roomState);
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
    if (!waitingOnQuestion) return;
    if (stalledIndex !== null && stalledIndex === waitingIndex) return;
    const timer = setTimeout(() => setStalledIndex(waitingIndex), STALLED_AFTER_MS);
    return () => clearTimeout(timer);
  }, [waitingOnQuestion, waitingIndex, stalledIndex]);
  const stalled = waitingOnQuestion && stalledIndex !== null && stalledIndex === waitingIndex;
  // A room repairing itself is neither waiting on a question nor broken, and saying "preparing
  // the next question" of an interview with no first question is the sentence that made three
  // different failures look identical (#89).
  const starting = parked && !stalled;

  if (!ready || stateQuery.isPending) {
    return <div className={styles.skeleton} data-testid="room-skeleton" />;
  }

  if (queryErrorCode) {
    return (
      <main id="content" tabIndex={-1} className={styles.room}>
        <div className={styles.errorCard}>
          <p role="alert" className={styles.error}>
            {errorMessage(queryErrorCode)}
          </p>
        </div>
      </main>
    );
  }

  if (!room) return null;

  // C02 — the interviewer's last line, which is what the room is actually showing. In voice it
  // is the caption; in text it is the bottom of the conversation. It is not always the question:
  // a follow-up, the handover line and the closing line are all things it says.
  const messages = room.messages ?? [];
  const lastSpoken = messages.filter((m) => m.role === 'assistant').at(-1) ?? null;
  // The question has been *delivered* once the interviewer has said something carrying its id.
  // Text mode has no typewriter to finish any more (the question arrives inside the
  // conversation), so this is what stands in for `typedFor` there — without it the phase would
  // sit on `typing-question` forever and the avatar would never stop speaking.
  const askedCurrent =
    room.currentQuestion &&
    messages.some((m) => m.role === 'assistant' && m.questionId === room.currentQuestion?.id)
      ? room.currentQuestion.id
      : null;

  const phase = roomPhase({
    state: room.state,
    question: room.currentQuestion,
    typedFor: voiceMode ? typedFor : askedCurrent,
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

  // A meeting does not open with a document on screen. In text the conversation IS the main
  // column now (C02), so the side panel would be the same thing twice and is never shown.
  const showTranscript = voiceMode ? (transcriptOpen ?? false) : false;
  const speaker = room.persona?.name ?? null;

  // K2 — the round decides who has the floor, audio only decides how loud. `room.persona` is
  // the same answer when the server resolved one; the round is the answer that always exists.
  const activeRound = resolveActiveSpeaker(room.state);
  const activeId =
    room.personas.find((persona) => persona.roundType === activeRound)?.id ??
    room.persona?.id ??
    null;

  async function handleSubmit(transcript: string): Promise<boolean> {
    if (!room?.currentQuestion) return false;
    setSubmitError(null);
    try {
      // C02 — a turn, not an answer: no questionId, because whether this closes the question is
      // the interviewer's call and not the room's. `widget` is the mode only when the
      // interviewer put a surface on screen for this question.
      await submit.mutateAsync({
        text: transcript,
        inputMode: room.currentQuestion.widget ? 'widget' : 'text',
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

  // No avatar warming in the waiting beat: the tiles draw the speaker as CSS bars, so nothing
  // here requests an avatar object and every preload hint expired unused (issue 126).
  const tiles = (
    <PersonaTiles
      personas={room.personas}
      activeId={activeId}
      activeState={avatarState}
      layout={voiceMode ? 'stage' : 'strip'}
      candidate={voiceMode ? { level: voice.micLevel, muted: voice.muted } : null}
    />
  );

  // The caption, voice only. It shows the interviewer's last *line* rather than the current
  // question row (C02): what was spoken is what should be captioned, and half of what the
  // interviewer says now belongs to no question at all. Falling back to the question row keeps
  // a pre-C02 interview — or one whose greeting failed to generate — captioned rather than blank.
  //
  // The waiting panel is the truth right up until it is not: past `STALLED_AFTER_MS` it would
  // keep promising a question nothing is generating, and a room that has not started has no
  // *next* question for it to be promising.
  const captionSource = lastSpoken
    ? { id: lastSpoken.id, text: lastSpoken.content }
    : room.currentQuestion;
  const question = stalled || starting ? null : (
    // One line, one instance: the panel's typed state resets by remount, not by effect.
    <QuestionPanel
      key={captionSource?.id ?? 'waiting'}
      question={captionSource}
      onTyped={setTypedFor}
      instant
      speaker={speaker ?? undefined}
      className={styles.caps}
    />
  );

  // C04 — the answer surface. Text mode always has one; voice mode gets one only when the
  // interviewer put a widget on screen, which is the whole point of `show_widget`: some
  // answers are a list or a precise value, and dictating those is worse than typing them.
  const widget = room.currentQuestion?.widget ?? null;
  const composer =
    room.currentQuestion && room.state !== 'paused' && !stalled && !starting && (!voiceMode || widget) ? (
      // Keyed on the question: a retained draft belongs to the question it was typed for. It
      // used to survive into the next one — across a pause and resume most of all — and be sent
      // as the answer to a question it never read (#90).
      <AnswerComposer
        key={room.currentQuestion.id}
        onSubmit={handleSubmit}
        pending={submit.isPending}
        error={submitError}
        widget={widget}
      />
    ) : null;

  // Three rooms the candidate cannot answer from, and they must not look alike: one is
  // starting itself, one is paused, one has given up. Only the last two carry a control —
  // the parked room's repair fires on arrival, and a button beside it would be a second
  // trigger for the request already in flight.
  //
  // Both controls lead to the same request: `POST /resume` resumes a pause, and regenerates
  // the batch when there is none.
  let notice: ReactNode = null;
  if (starting) {
    notice = (
      <div className={styles.notice} data-testid="room-starting">
        <p className={styles.noticeText} aria-live="polite">
          {t('starting')}
        </p>
      </div>
    );
  } else if (room.state === 'paused' || stalled) {
    notice = (
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
    );
  }

  return (
    <div className={styles.room} data-testid="interview-room">
      <SplitShell
        width="default"
        contain
        rail={
          <RoomRail
            room={room}
            roomUpdatedAt={stateQuery.dataUpdatedAt}
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
                {/* C04 — the one thing a voice room gets a keyboard for. It appears only when
                    the interviewer asked for it, so the room is still audio-first. */}
                {composer}
                {notice}
                {room.state !== 'paused' && !stalled && !starting ? (
                  <VoiceControls
                    session={voice}
                    expiresAt={room.expiresAt}
                    captionsOn={captionsOn}
                    onToggleCaptions={() => setCaptionsOn((on) => !on)}
                    transcriptOpen={showTranscript}
                    onToggleTranscript={() => setTranscriptOpen(!showTranscript)}
                  />
                ) : null}
              </div>
            </section>
          ) : (
            // Text is not this room with the audio off: a written exchange on the light surface,
            // the roster reduced to a strip, no stage and no controls. Since C02 it is a
            // conversation rather than one question at a time, so the record is the column
            // itself — the side panel would be the same content twice and is not rendered.
            <div className={styles.written}>
              {tiles}
              <Conversation
                messages={messages}
                speakerName={speaker ?? undefined}
                personas={room.personas}
              />
              {/* The waiting beat survives C02. A live round with no question is a real state —
                  the batch is still generating — and the conversation alone would leave the
                  last thing said on screen with no sign anything is coming, which reads as a
                  room that has quietly stopped. That is exactly the confusion #89 was about. */}
              {!room.currentQuestion && !stalled && !starting ? (
                <QuestionPanel
                  question={null}
                  onTyped={setTypedFor}
                  instant
                  className={styles.writtenSheet}
                />
              ) : null}
              {notice}
              {composer}
            </div>
          )}

          {voiceMode ? (
            <Conversation
              messages={messages}
              speakerName={speaker ?? undefined}
              personas={room.personas}
              live
              open={showTranscript}
            />
          ) : null}
        </div>
      </SplitShell>
    </div>
  );
}
