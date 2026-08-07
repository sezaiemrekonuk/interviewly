'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import styles from './room.module.css';

const CHARS_PER_SEC = 40;

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * The live question. In voice this is the room's captions — the lifted sheet at the foot of
 * the stage, with the speaker's name over it; in text it is the written prompt above the
 * composer. Same component, because it is the same question: the sheet's material is the
 * only thing the two modes disagree about, and that arrives as `className`.
 *
 * Typed at 40 chars/sec (ui §3.8) and instant under reduced motion. `onTyped` reports the
 * *question id*, not a bare "done": the avatar's speaking→listening transition has to belong
 * to the question that finished, or the next one skips its animation.
 *
 * Mounted with `key={question.id}` — one question, one component instance. That is what lets
 * the reduced-motion case be the *initial* state instead of a setState inside an effect.
 *
 * The full text is in the DOM from the first frame (`aria-live` + a visually complete
 * `<span>`): a screen reader must not have to wait 6 seconds for the question.
 */
export function QuestionPanel({
  question,
  onTyped,
  instant = false,
  speaker,
  className,
}: {
  question: { id: string; text: string } | null;
  onTyped: (questionId: string) => void;
  /** Voice mode (W10): the agent speaks the question, so typing it out races the audio. */
  instant?: boolean;
  /** Who is asking — the caption's eyebrow. Omitted when no persona is live. */
  speaker?: string;
  className?: string;
}) {
  const t = useTranslations('room');
  const id = question?.id ?? null;
  const text = question?.text ?? '';
  const [shown, setShown] = useState(() => (instant || prefersReducedMotion() ? text.length : 0));

  useEffect(() => {
    if (!id) return;

    if (instant || prefersReducedMotion() || text.length === 0) {
      onTyped(id);
      return;
    }

    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      setShown(count);
      if (count >= text.length) {
        clearInterval(timer);
        onTyped(id);
      }
    }, 1000 / CHARS_PER_SEC);

    return () => clearInterval(timer);
  }, [id, text, onTyped, instant]);

  if (!question) {
    // `currentQuestion: null` inside a live round is the waiting beat, not a blank sheet and
    // not a bare sentence: the sheet keeps its height and shows where the question will land.
    // Static — the room's one authored motion moment is the typing below.
    return (
      <div
        className={cx(className, styles.questionWaiting)}
        data-testid="question-waiting"
        aria-live="polite"
      >
        <div className={styles.waitingLines} aria-hidden="true">
          <span className={styles.waitingLine} />
          <span className={`${styles.waitingLine} ${styles.waitingLineShort}`} />
        </div>
        <p className={styles.waitingText}>{t('waiting')}</p>
      </div>
    );
  }

  return (
    <div className={className}>
      {speaker ? <span className={styles.eyebrow}>{speaker}</span> : null}
      <p className={styles.question} data-testid="question" aria-live="polite">
        <span className={styles.srOnly}>{question.text}</span>
        <span aria-hidden="true" data-testid="question-typed">
          {question.text.slice(0, shown)}
        </span>
      </p>
    </div>
  );
}
