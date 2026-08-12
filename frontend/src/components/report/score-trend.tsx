'use client';

import { useTranslations } from 'next-intl';

import { SCORE_MAX } from '../../lib/score';

import styles from './report.module.css';

const BAR = 24;
const GAP = 12;
const GROUP_GAP = 32;
const PLOT = 160;
const HEAD = 20;
const FOOT = 24;

const ROUNDS = ['hr', 'tech'] as const;

export interface TrendPoint {
  id: string;
  score: number;
  roundType: (typeof ROUNDS)[number];
}

export function ScoreTrend({ points, overall }: { points: TrendPoint[]; overall: number }) {
  const t = useTranslations('report');
  const height = HEAD + PLOT + FOOT;
  const topOf = (score: number) => HEAD + PLOT - (PLOT * score) / SCORE_MAX;

  const groups: { type: TrendPoint['roundType']; center: number; cols: (TrendPoint & { x: number })[] }[] = [];
  let cursor = GAP;
  for (const type of ROUNDS) {
    const inRound = points.filter((point) => point.roundType === type);
    if (inRound.length === 0) continue;
    if (groups.length > 0) cursor += GROUP_GAP;
    const start = cursor;
    const cols = inRound.map((point) => {
      const x = cursor;
      cursor += BAR + GAP;
      return { ...point, x };
    });
    groups.push({ type, center: (start + cursor - GAP) / 2, cols });
  }
  const width = cursor;

  return (
    <figure className={styles.trend}>
      <div className={styles.trendScroll}>
        <svg
          className={styles.chart}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
          focusable="false"
        >
          {groups.map((group) => (
            <g key={group.type}>
              {group.cols.map((col) => (
                <g key={col.id}>
                  <rect className={styles.chartTrack} x={col.x} y={HEAD} width={BAR} height={PLOT} />
                  <rect
                    className={group.type === 'hr' ? styles.chartBarHr : styles.chartBarTech}
                    x={col.x}
                    y={topOf(col.score)}
                    width={BAR}
                    height={HEAD + PLOT - topOf(col.score)}
                  />
                  <text
                    className={styles.chartValue}
                    x={col.x + BAR / 2}
                    y={topOf(col.score) - 6}
                    textAnchor="middle"
                  >
                    {col.score}
                  </text>
                </g>
              ))}
              <text
                className={styles.chartGroup}
                x={group.center}
                y={height - 6}
                textAnchor="middle"
              >
                {t(group.type === 'hr' ? 'roundHr' : 'roundTech')}
              </text>
            </g>
          ))}
          <line
            className={styles.chartAverage}
            x1={0}
            x2={width}
            y1={topOf(overall)}
            y2={topOf(overall)}
            strokeDasharray="4 4"
          />
        </svg>
      </div>
      <figcaption className={styles.trendCaption}>
        {t('trendCaption', { score: overall, max: SCORE_MAX })}
      </figcaption>
    </figure>
  );
}
