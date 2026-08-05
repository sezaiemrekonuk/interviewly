'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';

import type { AdminStatsResponse } from '../../lib/query';

import styles from './stats-panel.module.css';

/**
 * Series colour lives in CSS, not here: recharts writes `fill` as a presentation attribute,
 * which any stylesheet rule outranks. That keeps the hues on the tokens (`--accent`,
 * `--warning`, `--text-muted` — never `--primary`) and keeps literals out of the `.tsx` the
 * lint scans.
 */
const SPLIT_CLASSES = [styles.seriesAccent, styles.seriesWarning, styles.seriesMuted];

export function StatsPanel({ stats }: { stats: AdminStatsResponse }) {
  const t = useTranslations('admin');
  const format = useFormatter();

  const totalSeconds = Math.round(stats.averageDurationMs / 1000);
  const split = [
    { name: t('stats.completed'), value: stats.completed },
    { name: t('stats.cutShort'), value: stats.cutShort },
    { name: t('stats.unfinished'), value: stats.unfinished },
  ];
  // An all-zero platform still draws the ring — a zeroed chart, never a spinner or a gap.
  const splitTotal = split.reduce((sum, slice) => sum + slice.value, 0);
  const splitData = splitTotal === 0 ? split.map((slice) => ({ ...slice, value: 1 })) : split;

  return (
    <section className={styles.panel} aria-labelledby="admin-stats-heading">
      <h2 className={styles.srOnly} id="admin-stats-heading">
        {t('stats.heading')}
      </h2>

      <div className={styles.figures}>
        <div className={styles.card}>
          <p className={styles.figureLabel}>{t('stats.averageDuration')}</p>
          <p className={styles.figure} data-testid="admin-avg-duration">
            {t('stats.duration', {
              minutes: Math.floor(totalSeconds / 60),
              seconds: totalSeconds % 60,
            })}
          </p>
        </div>
        <div className={styles.card}>
          <p className={styles.figureLabel}>{t('stats.totalTokens')}</p>
          <p className={styles.figure} data-testid="admin-total-tokens">
            {format.number(stats.totalTokens)}
          </p>
        </div>
      </div>

      <div className={styles.charts}>
        <div className={styles.card}>
          <h3 className={styles.title}>{t('stats.splitTitle')}</h3>
          <div className={styles.chart} aria-hidden="true">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={splitData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={78}
                  isAnimationActive={false}
                >
                  {splitData.map((slice, i) => (
                    <Cell key={slice.name} className={SPLIT_CLASSES[i]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* The ring is decorative; these three lines are the readable version of it. */}
          <ul className={styles.legend} data-testid="admin-split">
            {split.map((slice, i) => (
              <li className={styles.legendRow} key={slice.name}>
                <span className={`${styles.swatch} ${SPLIT_CLASSES[i]}`} aria-hidden="true" />
                <span className={styles.legendLabel}>{slice.name}</span>
                <span className={styles.legendValue}>{format.number(slice.value)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.card}>
          <h3 className={styles.title}>{t('stats.occupationTitle')}</h3>
          {stats.perOccupation.length === 0 ? (
            <p className={styles.empty}>{t('stats.empty')}</p>
          ) : (
            <>
              <div className={styles.chart} aria-hidden="true">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={stats.perOccupation} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} />
                    <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={32} />
                    <Bar dataKey="count" className={styles.seriesAccent} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ul className={styles.legend} data-testid="admin-occupations">
                {stats.perOccupation.map((row) => (
                  <li className={styles.legendRow} key={row.cluster}>
                    <span className={styles.legendLabel}>{row.label}</span>
                    <span className={styles.legendValue}>{format.number(row.count)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className={styles.card}>
          <h3 className={styles.title}>{t('stats.weakestTitle')}</h3>
          {stats.weakestQuestions.length === 0 ? (
            <p className={styles.empty}>{t('stats.empty')}</p>
          ) : (
            <ul className={styles.weakList} data-testid="admin-weakest">
              {stats.weakestQuestions.map((question) => (
                <li className={styles.weakRow} key={question.questionId}>
                  <span className={styles.weakId}>{question.questionId}</span>
                  <span className={styles.weakScore}>{format.number(question.score)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
