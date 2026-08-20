'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button, Field, Select, Textarea } from '../ui';

import styles from './room.module.css';

const MAX_ANSWER_CHARS = 20_000;

/**
 * C04 — a typed answer surface the interviewer put on screen for this question. Some answers
 * are a list, a snippet or a precise value, and reading those aloud is worse than typing them;
 * in voice mode this is the only way to answer at all without dictating punctuation.
 */
export interface AnswerWidget {
  kind: 'textbox' | 'choice';
  label: string;
  options?: string[];
}

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
  widget = null,
}: {
  onSubmit: (transcript: string) => Promise<boolean>;
  pending: boolean;
  error: string | null;
  /**
   * When the interviewer has put a surface on screen, its label replaces the generic one and
   * a `choice` renders a native select instead of free text. Null is the ordinary composer,
   * which is still what most questions get.
   */
  widget?: AnswerWidget | null;
}) {
  const t = useTranslations('room');
  const [transcript, setTranscript] = useState('');
  const empty = transcript.trim().length === 0;
  const choices = widget?.kind === 'choice' ? (widget.options ?? []) : null;
  const charCount = transcript.length;
  const charPercent = charCount / MAX_ANSWER_CHARS;
  const isApproaching = charPercent > 0.8;
  const isExceeded = charPercent > 1;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (empty || pending) return;
    // Cleared only once the server took it — a refused answer is not retyped by the candidate.
    if (await onSubmit(transcript.trim())) setTranscript('');
  }

  return (
    <form className={styles.composer} onSubmit={handleSubmit} data-testid="answer-composer">
      <Field label={widget?.label ?? t('answerLabel')} id="answer">
        {(control) =>
          // A native select for a pick from two-to-six options: the platform already ships a
          // keyboard-complete, screen-reader-complete listbox, and a hand-built one would be a
          // worse copy of it. Free text everywhere else.
          choices ? (
            <Select
              {...control}
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
              disabled={pending}
            >
              <option value="">{t('choosePlaceholder')}</option>
              {choices.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          ) : (
            <>
              <Textarea
                {...control}
                className={styles.composerInput}
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
                placeholder={t('answerPlaceholder')}
                disabled={pending}
                rows={4}
                maxLength={MAX_ANSWER_CHARS}
              />
              <p
                className={`${styles.composerCounter} ${isApproaching && !isExceeded ? styles.approaching : ''} ${isExceeded ? styles.exceeded : ''}`}
              >
                {charCount.toLocaleString()} / {MAX_ANSWER_CHARS.toLocaleString()}
              </p>
            </>
          )
        }
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
