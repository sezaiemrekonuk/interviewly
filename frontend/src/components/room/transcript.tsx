'use client';

import { useTranslations } from 'next-intl';

import styles from './room.module.css';

export interface TranscriptTurn {
  questionId: string;
  question: string;
  answer: string;
  roundType: 'hr' | 'tech';
}

/**
 * The answered turns so far, straight off room-state. Read-only — W07 reuses it as-is.
 * `live` announces new turns as they land: in voice (W10) the transcript is the only place
 * the answer appears at all, so it has to reach a screen reader without a focus move.
 *
 * `open` is the panel's own state — a meeting does not open with a document on screen, so
 * voice starts it closed. Closed is *visually* hidden, never unmounted: the live region above
 * is the only record of a spoken answer, and unmounting it would stop it announcing.
 */
export function Transcript({
  turns,
  live = false,
  open = true,
}: {
  turns: TranscriptTurn[];
  live?: boolean;
  open?: boolean;
}) {
  const t = useTranslations('room');

  return (
    <section
      id="room-transcript"
      className={styles.transcriptPanel}
      data-testid="transcript"
      data-open={open ? 'true' : 'false'}
    >
      <h2 className={styles.transcriptTitle}>{t('transcriptTitle')}</h2>
      {turns.length === 0 ? (
        <p className={styles.transcriptEmpty}>{t('transcriptEmpty')}</p>
      ) : (
        <ol className={styles.transcriptList} aria-live={live ? 'polite' : undefined}>
          {turns.map((turn) => (
            <li key={turn.questionId} className={styles.turn}>
              {/* Speaker-labelled: who asked, then who answered. Room-state carries no
                  timestamps, so none are shown rather than invented. */}
              <div className={styles.turnPart}>
                <p className={styles.turnSpeaker}>
                  {turn.roundType === 'hr' ? t('roleHr') : t('roleTech')}
                </p>
                <p className={styles.turnQuestion}>{turn.question}</p>
              </div>
              <div className={styles.turnPart}>
                <p className={styles.turnSpeaker}>{t('speakerYou')}</p>
                <p className={styles.turnAnswer}>{turn.answer}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
