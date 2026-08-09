'use client';

import { useTranslations } from 'next-intl';

import type { TranscriptTurn } from '../room/transcript';
import { Meter } from '../shell/meter';
import type { ReportPayload } from '../../lib/query';
import { SCORE_MAX } from '../../lib/score';

import styles from './report.module.css';

/** `interviews.ended_reason` values that mean the run did not reach its last question. */
const EARLY_END_REASONS = new Set(['cut_short', 'budget_exhausted', 'time_exhausted', 'abandoned', 'error']);

/**
 * The scored read-back: nothing here is computed, every number is `reports.payload` as the
 * model produced it and the K15 gate accepted it.
 *
 * One reading column on the working surface — the verdict, then the rounds, then what worked
 * and what to work on, then the question rows. The headline score and the PDF are the rail's
 * (`report-rail.tsx`), so this column starts on the sentence rather than on the number.
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
  // nothing rather than a scored row with no question attached to it. The turn also carries
  // `roundType`, which is what tells a technical row that STAR does not apply to it.
  const turnFor = new Map(turns.map((turn) => [turn.questionId, turn]));
  const rows = payload.questions.flatMap((question) => {
    const turn = turnFor.get(question.question_id);
    return turn ? [{ question, turn }] : [];
  });

  return (
    <div className={styles.report} data-testid="report-view">
      {isEarlyEnd ? (
        <p role="status" className={styles.earlyEnd} data-testid="report-early-end">
          {t('earlyEnd')}
        </p>
      ) : null}

      <p className={styles.impression}>{payload.overall_impression}</p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('roundsTitle')}</h2>
        <ul className={styles.rows}>
          {payload.rounds.map((round, idx) => (
            <li key={`${round.type}-${idx}`} className={styles.row}>
              <h3 className={styles.rowTitle}>{t(round.type === 'hr' ? 'roundHr' : 'roundTech')}</h3>
              <span className={`${styles.rowScore} tabular`}>
                {t('scoreValue', { score: round.score, max: SCORE_MAX })}
              </span>
              {/* Decorative: the score sits on the same line, in text. */}
              <Meter className={styles.rowMeter} value={round.score} max={SCORE_MAX} decorative />
              <p className={styles.rowBody}>{round.summary}</p>
              {round.note ? <p className={styles.rowNote}>{round.note}</p> : null}
            </li>
          ))}
        </ul>
      </section>

      {/* Two plain lists, not two tinted walls: on a result surface a green box and an orange
          box next to each other read as pass and fail, which is not what these are. */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('strengths')}</h2>
        <ul className={styles.bullets}>
          {payload.strengths.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('improvements')}</h2>
        <ul className={styles.bullets}>
          {payload.improvements.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('questionsTitle')}</h2>
        <ul className={styles.rows} data-testid="report-questions">
          {rows.map(({ question, turn }) => (
            <li key={question.question_id} className={styles.row}>
              <p className={styles.questionText}>{turn.question}</p>
              <span className={`${styles.rowScore} tabular`}>
                {t('scoreValue', { score: question.score, max: SCORE_MAX })}
              </span>
              <Meter className={styles.rowMeter} value={question.score} max={SCORE_MAX} decorative />
              <p className={styles.rowBody}>{question.reason}</p>
              {/* STAR is a behavioural-story rubric. The scorer returns 0 for a technical
                  answer because none applies, not because the answer failed — printed as
                  "STAR 0%" under an 80 it reads as broken scoring. The round comes off the
                  transcript turn, which every rendered row already has. */}
              {turn.roundType === 'tech' ? (
                <p className={styles.star}>{t('starNotApplicable')}</p>
              ) : (
                <p className={`${styles.star} tabular`}>
                  {t('star', { percent: Math.round(question.star_adherence * 100) })}
                </p>
              )}
            </li>
          ))}
        </ul>

        {/* What those two words mean, once under the list rather than repeated on every row —
            and only when a technical row is on screen to explain. Same sentence as the
            archive's table (`components/interviews/question-table.tsx`). */}
        {rows.some(({ turn }) => turn.roundType === 'tech') ? (
          <p className={styles.starNote}>{t('starNote')}</p>
        ) : null}
      </section>
    </div>
  );
}
