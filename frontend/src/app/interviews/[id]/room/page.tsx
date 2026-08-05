'use client';

import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { AvatarPreload } from '../../../../components/avatar';
import { AnswerComposer } from '../../../../components/room/answer-composer';
import { PersonaTiles } from '../../../../components/room/persona-tiles';
import { QuestionPanel } from '../../../../components/room/question-panel';
import { Transcript } from '../../../../components/room/transcript';
import { Button } from '../../../../components/ui';
import { routeForError } from '../../../../lib/error-routing';
import { ApiError, useInterviewState, useResumeInterview, useSubmitAnswer } from '../../../../lib/query';
import { resolveAvatarState, roomPhase } from '../../../../lib/room-avatar';
import { useErrorMessage } from '../../../../lib/use-error-message';
import { useInterviewEvents } from '../../../../lib/use-interview-events';
import { useRequireAuth } from '../../../../lib/use-require-auth';

import styles from '../../../../components/room/room.module.css';

/** Past the last answer: the report surface (W07) owns the wait and the result. */
const REPORT_STATES = new Set(['evaluating', 'completed', 'failed', 'abandoned']);

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

  const room = stateQuery.data;
  const pathname = `/interviews/${id}/room`;
  const queryErrorCode = stateQuery.error?.code ?? null;
  const roomState = room?.state ?? null;

  // Navigation belongs in an effect: routing during render is what makes a redirect fire twice.
  useEffect(() => {
    if (queryErrorCode) routeForError(queryErrorCode, router, { pathname });
  }, [queryErrorCode, router, pathname]);

  useEffect(() => {
    if (roomState && REPORT_STATES.has(roomState)) router.replace(`/interviews/${id}`);
  }, [roomState, router, id]);

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
  const avatarState = resolveAvatarState(phase, room.persona?.avatarState ?? 'idle');
  const progressPercent = room.targetQuestionCount
    ? Math.round((Math.min(room.currentIndex, room.targetQuestionCount) / room.targetQuestionCount) * 100)
    : 0;

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

  return (
    <main className={styles.room} data-testid="interview-room">
      <PersonaTiles
        personas={room.personas}
        activeId={room.persona?.id ?? null}
        activeState={avatarState}
      />

      {/* The waiting beat is where both sets are warmed — the handover must not fetch. */}
      {room.currentQuestion ? null : (
        <AvatarPreload sets={room.personas.map((persona) => persona.avatarSet)} />
      )}

      <section className={styles.stage}>
        <div className={styles.progressRow}>
          <p className={styles.progress}>
            {t('progress', {
              index: Math.min(room.currentIndex, room.targetQuestionCount),
              total: room.targetQuestionCount,
            })}
          </p>
          {/* Decorative: the line above is the accessible truth (ui §4.4). */}
          <div className={styles.track} aria-hidden="true">
            <div className={styles.trackFill} style={{ width: `${progressPercent}%` }} />
          </div>
        </div>

        {/* One question, one instance: the panel's typed state resets by remount, not by effect. */}
        <QuestionPanel
          key={room.currentQuestion?.id ?? 'waiting'}
          question={room.currentQuestion}
          onTyped={setTypedFor}
        />
      </section>

      {room.state === 'paused' ? (
        <div className={styles.paused}>
          <p className={styles.pausedText}>{t('paused')}</p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => resume.mutate()}
            loading={resume.isPending}
          >
            {t('resume')}
          </Button>
        </div>
      ) : null}

      <Transcript turns={room.transcript} />

      {/* Last in the DOM as well as on screen: a sticky composer above the transcript would
          pin itself to the middle of the page. */}
      {room.currentQuestion && room.state !== 'paused' ? (
        <AnswerComposer onSubmit={handleSubmit} pending={submit.isPending} error={submitError} />
      ) : null}
    </main>
  );
}
