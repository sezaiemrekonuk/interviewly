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
        <h1>{t('title')}</h1>
        <p className={styles.score} data-testid="report-score">
          <span className={styles.scoreLabel}>{t('scoreLabel')}</span>
          {t('scoreValue', { score: payload.overall_score })}
        </p>
        <p className={styles.impression}>{payload.overall_impression}</p>
      </header>

      <h2 className={styles.sectionTitle}>{t('roundsTitle')}</h2>
      <ul className={styles.rounds}>
        {payload.rounds.map((round) => (
          <li key={round.type} className={styles.round}>
            <h3>{t(round.type === 'hr' ? 'roundHr' : 'roundTech')}</h3>
            <p className={styles.roundScore}>{t('scoreValue', { score: round.score })}</p>
            <p>{round.summary}</p>
            {round.note ? <p className={styles.note}>{round.note}</p> : null}
          </li>
        ))}
      </ul>

      <div className={styles.narrative}>
        <section>
          <h2 className={styles.sectionTitle}>{t('strengths')}</h2>
          <ul>
            {payload.strengths.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className={styles.sectionTitle}>{t('improvements')}</h2>
          <ul>
            {payload.improvements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <h2 className={styles.sectionTitle}>{t('questionsTitle')}</h2>
      <ul className={styles.questions} data-testid="report-questions">
        {payload.questions
          .filter((question) => questionText.has(question.question_id))
          .map((question) => (
            <li key={question.question_id} className={styles.question}>
              <p className={styles.questionText}>{questionText.get(question.question_id)}</p>
              <p className={styles.questionScore}>
                {t('scoreValue', { score: question.score })}
                <span className={styles.star}>
                  {t('star', { percent: Math.round(question.star_adherence * 100) })}
                </span>
              </p>
              <p>{question.reason}</p>
            </li>
          ))}
      </ul>
    </section>
  );
}
