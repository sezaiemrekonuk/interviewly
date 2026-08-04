'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import styles from './room.module.css';

/**
 * Presentational: the page owns the mutation, so the room's phase (and the avatar's
 * `acknowledging` beat) reads one `isPending`, not a copy kept in here.
 */
export function AnswerComposer({
  onSubmit,
  pending,
  error,
}: {
  onSubmit: (transcript: string) => Promise<boolean>;
  pending: boolean;
  error: string | null;
}) {
  const t = useTranslations('room');
  const [transcript, setTranscript] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!transcript.trim() || pending) return;
    // Cleared only once the server took it — a refused answer is not retyped by the candidate.
    if (await onSubmit(transcript.trim())) setTranscript('');
  }

  return (
    <form className={styles.composer} onSubmit={handleSubmit} data-testid="answer-composer">
      <label className={styles.composerLabel} htmlFor="answer">
        {t('answerLabel')}
      </label>
      <textarea
        id="answer"
        className={styles.composerInput}
        value={transcript}
        onChange={(event) => setTranscript(event.target.value)}
        placeholder={t('answerPlaceholder')}
        disabled={pending}
        rows={4}
      />
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className={styles.submit}
        disabled={pending || transcript.trim().length === 0}
      >
        {pending ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
