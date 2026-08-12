'use client';

import { useFormatter, useTranslations } from 'next-intl';

import type { AdminCostModel } from '../../../lib/query';

import styles from './charts.module.css';
import { seriesKey, seriesLabel, seriesShare, seriesToken } from './series';

export function ModelLegend({
  models,
  totalUsd,
  money,
}: {
  models: AdminCostModel[];
  totalUsd: string;
  money?: boolean;
}) {
  const t = useTranslations('admin');
  const format = useFormatter();

  return (
    <ul className={styles.legend}>
      {models.map((row, index) => (
        <li className={styles.legendRow} key={seriesKey(row)}>
          <span className={styles.swatch} data-series={seriesToken(row, index)} />
          <span className={styles.legendLabel}>{seriesLabel(row, t('costs.otherModels'))}</span>
          <span className={`${styles.legendValue} tabular`}>
            {format.number(seriesShare(row, totalUsd), {
              style: 'percent',
              maximumFractionDigits: 0,
            })}
            {money ? ` · ${row.costUsd}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
