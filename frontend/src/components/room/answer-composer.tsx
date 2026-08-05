'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button, Field, Textarea } from '../ui';

import styles from './room.module.css';

/**
 * Presentational: the page owns the mutation, so the room's phase (and the avatar's
 * `acknowledging` beat) reads one `isPending`, not a copy kept in here.
 *
 * Pinned to the bottom of the room as one block — label, input, the reason the send button
 * is off, and the button itself.
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
  const empty = transcript.trim().length === 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (empty || pending) return;
    // Cleared only once the server took it — a refused answer is not retyped by the candidate.
    if (await onSubmit(transcript.trim())) setTranscript('');
  }

  return (
    <form className={styles.composer} onSubmit={handleSubmit} data-testid="answer-composer">
      <Field label={t('answerLabel')} id="answer">
        {(control) => (
          <Textarea
            {...control}
            className={styles.composerInput}
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            placeholder={t('answerPlaceholder')}
            disabled={pending}
            rows={4}
          />
        )}
      </Field>

      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}

      <div className={styles.composerActions}>
        {/* Disabled with the reason in words, not a grey pill the user has to interpret. */}
        {empty && !pending ? <p className={styles.composerHint}>{t('submitHint')}</p> : null}
        <Button type="submit" size="lg" loading={pending} disabled={empty}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
