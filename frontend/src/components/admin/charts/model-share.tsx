'use client';

import { useTranslations } from 'next-intl';

import type { AdminCostsResponse } from '../../../lib/query';
import { microUsd } from '../interview-table';

import styles from './charts.module.css';
import { donutSlices } from './geometry';
import { seriesKey, seriesLabel, seriesShare, seriesToken } from './series';

const RADIUS = 70;
const CENTER = 90;
const SIZE = CENTER * 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const ARC_CLASS = {
  s1: 'arcS1',
  s2: 'arcS2',
  s3: 'arcS3',
  sOther: 'arcSOther',
} as const;

export function ModelShare({ data }: { data: AdminCostsResponse }) {
  const t = useTranslations('admin');

  const values = data.models.map((row) => microUsd(row.costUsd));
  const spent = values.some((value) => value > 0);
  const slices = donutSlices(values, CIRCUMFERENCE);

  return (
    <figure className={styles.card} data-testid="admin-cost-share">
      <h3 className={styles.title}>{t('costs.shareTitle')}</h3>

      <div className={styles.share}>
        <svg width={SIZE} height={SIZE} aria-hidden="true" focusable="false">
          <circle
            className={`${styles.arc} ${styles.arcSOther}`}
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
          />
          <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
            {spent
              ? slices.map((slice, index) => {
                  const row = data.models[index];
                  return (
                    <circle
                      key={seriesKey(row)}
                      className={`${styles.arc} ${styles[ARC_CLASS[seriesToken(row, index)]]}`}
                      cx={CENTER}
                      cy={CENTER}
                      r={RADIUS}
                      strokeDasharray={slice.dash}
                      strokeDashoffset={slice.offset}
                    />
                  );
                })
              : null}
          </g>
          <text className={styles.value} x={CENTER} y={CENTER + 5} textAnchor="middle">
            {data.totals.costUsd}
          </text>
        </svg>

        {spent ? (
          <ul className={styles.legend}>
            {data.models.map((row, index) => (
              <li className={styles.legendRow} key={seriesKey(row)}>
                <span className={styles.swatch} data-series={seriesToken(row, index)} />
                <span className={styles.legendLabel}>
                  {seriesLabel(row, t('costs.otherModels'))}
                </span>
                <span className={`${styles.legendValue} tabular`}>
                  {Math.round(seriesShare(row, data.totals.costUsd) * 100)}% · {row.costUsd}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>{t('costs.noSpendRange')}</p>
        )}
      </div>

      <figcaption className={styles.caption}>
        {t('costs.shareCaption', { total: data.totals.costUsd })}
      </figcaption>
    </figure>
  );
}
