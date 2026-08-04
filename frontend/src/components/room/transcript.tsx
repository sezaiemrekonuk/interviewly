'use client';

import { useTranslations } from 'next-intl';

import styles from './room.module.css';

export interface TranscriptTurn {
  questionId: string;
  question: string;
  answer: string;
  roundType: 'hr' | 'tech';
}

/** The answered turns so far, straight off room-state. Read-only — W07 reuses it as-is. */
export function Transcript({ turns }: { turns: TranscriptTurn[] }) {
  const t = useTranslations('room');

  return (
    <section className={styles.transcript} data-testid="transcript">
      <h2 className={styles.transcriptTitle}>{t('transcriptTitle')}</h2>
      {turns.length === 0 ? (
        <p className={styles.transcriptEmpty}>{t('transcriptEmpty')}</p>
      ) : (
        <ol className={styles.transcriptList}>
          {turns.map((turn) => (
            <li key={turn.questionId} className={styles.turn}>
              <p className={styles.turnQuestion}>{turn.question}</p>
              <p className={styles.turnAnswer}>{turn.answer}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
