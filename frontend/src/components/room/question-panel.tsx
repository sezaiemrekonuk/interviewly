'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import styles from './room.module.css';

const CHARS_PER_SEC = 40;

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * The live question, typed at 40 chars/sec (ui §3.8) and instant under reduced motion.
 * `onTyped` reports the *question id*, not a bare "done": the avatar's speaking→listening
 * transition has to belong to the question that finished, or the next one skips its animation.
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
}: {
  question: { id: string; text: string } | null;
  onTyped: (questionId: string) => void;
}) {
  const t = useTranslations('room');
  const id = question?.id ?? null;
  const text = question?.text ?? '';
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? text.length : 0));

  useEffect(() => {
    if (!id) return;

    if (prefersReducedMotion() || text.length === 0) {
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
  }, [id, text, onTyped]);

  if (!question) {
    // `currentQuestion: null` inside a live round is the waiting beat, not a blank panel.
    return (
      <p className={styles.waiting} data-testid="question-waiting">
        {t('waiting')}
      </p>
    );
  }

  return (
    <p className={styles.question} data-testid="question" aria-live="polite">
      <span className={styles.srOnly}>{question.text}</span>
      <span aria-hidden="true" data-testid="question-typed">
        {question.text.slice(0, shown)}
      </span>
    </p>
  );
}
