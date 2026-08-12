'use client';

import { useTranslations } from 'next-intl';

import type { AdminCostsResponse } from '../../../lib/query';
import { microUsd } from '../interview-table';

import styles from './charts.module.css';
import { labelledIndexes, niceMax, stackBands, tickValues } from './geometry';
import { seriesKey, seriesLabel, seriesShare, seriesToken } from './series';

const GUTTER = 64;
const TOP = 12;
const PLOT_W = 600;
const PLOT_H = 176;
const FOOT = 28;
const TICKS = 4;
const DATE_LABELS = 4;

const scale = (micro: number) => (micro / 1_000_000).toFixed(4);

export function ModelMix({ data }: { data: AdminCostsResponse }) {
  const t = useTranslations('admin');

  const width = GUTTER + PLOT_W + 8;
  const height = TOP + PLOT_H + FOOT;
  const baseline = TOP + PLOT_H;

  const series = data.models.map((row) => row.daily.map(microUsd));
  const totals = data.buckets.map((_, index) =>
    series.reduce((sum, values) => sum + (values[index] ?? 0), 0),
  );
  const max = niceMax(Math.max(0, ...totals));
  const spent = totals.some((total) => total > 0);
  const polygons = stackBands(series, { width: PLOT_W, height: PLOT_H }, max);

  return (
    <figure className={styles.card} data-testid="admin-cost-mix">
      <h3 className={styles.title}>{t('costs.mixTitle')}</h3>

      <div className={styles.scroller}>
        <svg
          className={styles.plot}
          width={width}
          height={height}
          aria-hidden="true"
          focusable="false"
        >
          {tickValues(max, TICKS).map((tick) => {
            const y = baseline - (tick / max) * PLOT_H;
            return (
              <g key={tick}>
                <line className={styles.grid} x1={GUTTER} x2={GUTTER + PLOT_W} y1={y} y2={y} />
                <text className={styles.tick} x={GUTTER - 8} y={y + 4} textAnchor="end">
                  {scale(tick)}
                </text>
              </g>
            );
          })}

          <g transform={`translate(${GUTTER},${TOP})`}>
            {polygons.map((points, index) => {
              const row = data.models[index];
              const token = seriesToken(row, index);
              return points ? (
                <polygon
                  key={seriesKey(row)}
                  className={`${styles.band} ${styles[token]}`}
                  points={points}
                />
              ) : null;
            })}
          </g>

          <line className={styles.axis} x1={GUTTER} x2={GUTTER + PLOT_W} y1={baseline} y2={baseline} />
          <line className={styles.axis} x1={GUTTER} x2={GUTTER} y1={TOP} y2={baseline} />

          {labelledIndexes(data.buckets.length, DATE_LABELS).map((index, position, all) => {
            const step = data.buckets.length === 1 ? 0 : PLOT_W / (data.buckets.length - 1);
            const x = GUTTER + (data.buckets.length === 1 ? PLOT_W / 2 : index * step);
            const anchor =
              position === 0 ? 'start' : position === all.length - 1 ? 'end' : 'middle';
            return (
              <text
                className={styles.tick}
                key={data.buckets[index]}
                x={x}
                y={baseline + 20}
                textAnchor={anchor}
              >
                {data.buckets[index].slice(5)}
              </text>
            );
          })}
        </svg>
      </div>

      {spent ? (
        <ul className={styles.legend}>
          {data.models.map((row, index) => (
            <li className={styles.legendRow} key={seriesKey(row)}>
              <span className={styles.swatch} data-series={seriesToken(row, index)} />
              <span className={styles.legendLabel}>
                {seriesLabel(row, t('costs.otherModels'))}
              </span>
              <span className={`${styles.legendValue} tabular`}>
                {Math.round(seriesShare(row, data.totals.costUsd) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>{t('costs.noSpendRange')}</p>
      )}

      <figcaption className={styles.caption}>
        {t('costs.mixCaption', { from: data.from, to: data.to })}
      </figcaption>
    </figure>
  );
}
