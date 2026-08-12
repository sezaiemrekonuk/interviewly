'use client';

import { useTranslations } from 'next-intl';

import type { AdminCostModel } from '../../../lib/query';

import styles from './charts.module.css';
import { COMPARE_LIMIT, seriesKey, seriesLabel, seriesStyle } from './series';

export function SeriesPicker({
  models,
  chosen,
  onToggle,
}: {
  models: AdminCostModel[];
  chosen: string[];
  onToggle: (key: string) => void;
}) {
  const t = useTranslations('admin');
  const full = chosen.length >= COMPARE_LIMIT;

  return (
    <div className={styles.picker}>
      <span className={styles.controlLabel}>{t('costs.series')}</span>
      <ul className={styles.chips}>
        {models.map((row) => {
          const key = seriesKey(row);
          const rank = chosen.indexOf(key);
          const on = rank >= 0;
          const style = on ? seriesStyle(rank) : null;

          return (
            <li key={key}>
              <button
                type="button"
                className={styles.chip}
                aria-pressed={on}
                disabled={!on && full}
                data-testid={`admin-cost-series-${key}`}
                onClick={() => onToggle(key)}
              >
                <span
                  className={styles.lineSwatch}
                  data-series={style?.token ?? 'off'}
                  data-dashed={style?.dashed || undefined}
                />
                {seriesLabel(row, t('costs.otherModels'))}
              </button>
            </li>
          );
        })}
      </ul>
      {full ? <p className={styles.pickerNote}>{t('costs.seriesCap')}</p> : null}
    </div>
  );
}
