'use client';

import { useFormatter, useTranslations } from 'next-intl';

import type { AdminStatsResponse } from '../../lib/query';
import { Meter } from '../shell/meter';
import { Spec } from '../shell/split-shell';

import styles from './panels.module.css';

/** `report_questions.score` is an integer 0..5 (packages/ai `schemas.ts`) — the bar's ceiling. */
const SCORE_MAX = 5;

/**
 * The Overview surface: what is true across the whole platform. `/admin/stats` is all-time
 * and takes no filters, so there is no range to show and none is implied.
 *
 * Bars are `Meter`, not a chart library: every quantity here is one value against one
 * ceiling, the numbers are printed beside them anyway, and a <progress> carries its value as
 * a DOM property — which is the only kind of bar that survives the CSP's ban on style
 * attributes.
 */
export function StatsPanel({ stats }: { stats: AdminStatsResponse }) {
  const t = useTranslations('admin');
  const format = useFormatter();

  const totalSeconds = Math.round(stats.averageDurationMs / 1000);

  const split = [
    { key: 'completed', name: t('stats.completed'), value: stats.completed, note: null },
    // `ended_reason` is never written as `cut_short` anywhere in the backend, so this
    // number is structurally 0 rather than "no interviews were cut short".
    { key: 'cutShort', name: t('stats.cutShort'), value: stats.cutShort, note: t('stats.cutShortNote') },
    { key: 'unfinished', name: t('stats.unfinished'), value: stats.unfinished, note: null },
  ];
  const splitTotal = split.reduce((sum, slice) => sum + slice.value, 0);
  const occupationMax = Math.max(1, ...stats.perOccupation.map((row) => row.count));

  return (
    <section className={styles.panel} aria-labelledby="admin-stats-heading">
      <h2 className={styles.srOnly} id="admin-stats-heading">
        {t('stats.heading')}
      </h2>

      <div className={styles.figures}>
        <div className={styles.figure}>
          <span className={styles.eyebrow}>{t('stats.averageDuration')}</span>
          <p className={`${styles.figureValue} tabular`} data-testid="admin-avg-duration">
            {t('stats.duration', {
              minutes: Math.floor(totalSeconds / 60),
              seconds: totalSeconds % 60,
            })}
          </p>
        </div>
        <div className={styles.figure}>
          <span className={styles.eyebrow}>{t('stats.totalTokens')}</span>
          <p className={`${styles.figureValue} tabular`} data-testid="admin-total-tokens">
            {format.number(stats.totalTokens)}
          </p>
        </div>
      </div>

      <div className={styles.card}>
        <h3 className={styles.title}>{t('stats.splitTitle')}</h3>
        <ul className={styles.rows} data-testid="admin-split">
          {split.map((slice) => (
            <li className={styles.row} key={slice.key}>
              <span className={styles.rowLabel}>{slice.name}</span>
              <span className={`${styles.rowValue} tabular`}>{format.number(slice.value)}</span>
              <Meter
                className={styles.rowMeter}
                value={slice.value}
                max={splitTotal}
                decorative
              />
              {slice.note ? (
                <p className={styles.rowNote}>
                  {slice.note} <Spec />
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.pair}>
        <div className={styles.card}>
          <h3 className={styles.title}>{t('stats.occupationTitle')}</h3>
          {stats.perOccupation.length === 0 ? (
            <p className={styles.empty}>{t('stats.empty')}</p>
          ) : (
            <ul className={styles.rows} data-testid="admin-occupations">
              {stats.perOccupation.map((row) => (
                <li className={styles.row} key={row.cluster}>
                  <span className={styles.rowLabel}>{row.label}</span>
                  <span className={`${styles.rowValue} tabular`}>{format.number(row.count)}</span>
                  <Meter
                    className={styles.rowMeter}
                    value={row.count}
                    max={occupationMax}
                    decorative
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.card}>
          <h3 className={styles.title}>{t('stats.weakestTitle')}</h3>
          {stats.weakestQuestions.length === 0 ? (
            <p className={styles.empty}>{t('stats.empty')}</p>
          ) : (
            <>
              {/* The endpoint returns the id and the score, nothing else. Printing the id
                  alone and calling it a question is what this line exists to correct. */}
              <p className={styles.note}>{t('stats.weakestNote')}</p>
              <ul className={styles.rows} data-testid="admin-weakest">
                {stats.weakestQuestions.map((question) => (
                  <li className={styles.row} key={question.questionId}>
                    <span className={`${styles.rowLabel} tabular`}>{question.questionId}</span>
                    <span className={`${styles.rowValue} tabular`}>
                      {format.number(question.score)}
                    </span>
                    <Meter
                      className={styles.rowMeter}
                      value={question.score}
                      max={SCORE_MAX}
                      decorative
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
