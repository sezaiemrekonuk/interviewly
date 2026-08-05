'use client';

import { useTranslations } from 'next-intl';

import type { TranscriptTurn } from '../room/transcript';
import type { ReportPayload } from '../../lib/query';

import styles from './report.module.css';

/** `interviews.ended_reason` values that mean the run did not reach its last question. */
const EARLY_END_REASONS = new Set(['cut_short', 'budget_exhausted', 'time_exhausted', 'abandoned', 'error']);

/**
 * The scored read-back: nothing here is computed, every number is `reports.payload` as the
 * model produced it and the K15 gate accepted it. Flat `--bg`/`--shadow-hairline`, no
 * gradient, no mascot — this is a result surface, not an entry one.
 */
export function ReportView({
  payload,
  endedReason,
  turns,
}: {
  payload: ReportPayload;
  endedReason: string | null;
  turns: TranscriptTurn[];
}) {
  const t = useTranslations('report');
  const isEarlyEnd = endedReason !== null && EARLY_END_REASONS.has(endedReason);
  // Per-question rows key off the transcript, so a model-invented `question_id` renders
  // nothing rather than a scored row with no question attached to it.
  const questionText = new Map(turns.map((turn) => [turn.questionId, turn.question]));

  return (
    <section className={styles.report} data-testid="report-view">
      {isEarlyEnd ? (
        <p role="status" className={styles.earlyEnd} data-testid="report-early-end">
          {t('earlyEnd')}
        </p>
      ) : null}

      <header className={styles.header}>
        <h1 className={styles.title}>{t('title')}</h1>
        <div className={styles.score} data-testid="report-score">
          <span className={styles.scoreLabel}>{t('scoreLabel')}</span>
          <p className={styles.scoreFigure}>
            <span className={styles.scoreNumber}>{payload.overall_score}</span>
            <span className={styles.scoreMax}>{t('scoreMax')}</span>
          </p>
        </div>
        <p className={styles.impression}>{payload.overall_impression}</p>
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('roundsTitle')}</h2>
        <ul className={styles.rounds}>
          {payload.rounds.map((round, idx) => (
            <li key={`${round.type}-${idx}`} className={styles.round}>
              <div className={styles.roundHead}>
                <h3 className={styles.roundTitle}>
                  {t(round.type === 'hr' ? 'roundHr' : 'roundTech')}
                </h3>
                <span className={styles.scoreChip}>{t('scoreValue', { score: round.score })}</span>
              </div>
              <p className={styles.body}>{round.summary}</p>
              {round.note ? <p className={styles.note}>{round.note}</p> : null}
            </li>
          ))}
        </ul>
      </section>

      {/* Tinted, not colour-coded walls: what worked reads success-tinted, what to work on
          reads primary-tinted, and both stay ordinary body text. */}
      <div className={styles.narrative}>
        <section className={`${styles.block} ${styles.blockStrengths}`}>
          <h2 className={styles.sectionTitle}>{t('strengths')}</h2>
          <ul className={styles.blockList}>
            {payload.strengths.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section className={`${styles.block} ${styles.blockImprovements}`}>
          <h2 className={styles.sectionTitle}>{t('improvements')}</h2>
          <ul className={styles.blockList}>
            {payload.improvements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('questionsTitle')}</h2>
        <ul className={styles.questions} data-testid="report-questions">
          {payload.questions
            .filter((question) => questionText.has(question.question_id))
            .map((question) => (
              <li key={question.question_id} className={styles.question}>
                <div className={styles.questionHead}>
                  <p className={styles.questionText}>{questionText.get(question.question_id)}</p>
                  <span className={styles.scoreChip}>
                    {t('scoreValue', { score: question.score })}
                  </span>
                </div>
                <p className={styles.body}>{question.reason}</p>
                <p className={styles.star}>
                  {t('star', { percent: Math.round(question.star_adherence * 100) })}
                </p>
              </li>
            ))}
        </ul>
      </section>
    </section>
  );
}
