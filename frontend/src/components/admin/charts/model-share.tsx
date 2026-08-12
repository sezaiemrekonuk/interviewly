'use client';

import type { AdminCostModel } from '../../../lib/query';
import { microUsd } from '../interview-table';

import styles from './charts.module.css';
import { donutSlices } from './geometry';
import { ModelLegend } from './model-legend';
import { ARC_CLASS, seriesKey, seriesToken } from './series';

const RADIUS = 70;
const CENTER = 90;
const SIZE = CENTER * 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const TEXT_DY = 5;

export function ModelShare({ models, totalUsd }: { models: AdminCostModel[]; totalUsd: string }) {
  const values = models.map((row) => microUsd(row.costUsd));
  const spent = values.some((value) => value > 0);
  const slices = donutSlices(values, CIRCUMFERENCE);

  return (
    <div className={styles.share}>
      <svg width={SIZE} height={SIZE} aria-hidden="true" focusable="false">
        <circle className={`${styles.arc} ${styles.arcSOther}`} cx={CENTER} cy={CENTER} r={RADIUS} />
        <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
          {spent
            ? slices.map((slice, index) => {
                const row = models[index];
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
        <text className={styles.value} x={CENTER} y={CENTER + TEXT_DY} textAnchor="middle">
          {totalUsd}
        </text>
      </svg>

      <ModelLegend models={models} totalUsd={totalUsd} money />
    </div>
  );
}
