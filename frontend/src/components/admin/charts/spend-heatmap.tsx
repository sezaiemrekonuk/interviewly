'use client';

import { useTranslations } from 'next-intl';

import type { AdminCostsResponse } from '../../../lib/query';
import { ACTIVITY_TIERS, activityTier } from '../../dashboard/summary';
import { microUsd } from '../interview-table';

import styles from './charts.module.css';

const DAYS = 7;
const HOURS = 24;
const HOUR_STEP = 3;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function usd(micro: number): string {
  return (micro / 1_000_000).toFixed(6);
}

export function SpendHeatmap({ data }: { data: AdminCostsResponse }) {
  const t = useTranslations('admin');

  const grid: number[][] = Array.from({ length: DAYS }, () => Array.from({ length: HOURS }, () => 0));
  for (const bucket of data.hourly) {
    grid[bucket.dow][bucket.hour] = microUsd(bucket.costUsd);
  }

  let max = 0;
  let peakDow = 0;
  let peakHour = 0;
  for (let dow = 0; dow < DAYS; dow += 1) {
    for (let hour = 0; hour < HOURS; hour += 1) {
      if (grid[dow][hour] > max) {
        max = grid[dow][hour];
        peakDow = dow;
        peakHour = hour;
      }
    }
  }

  const hours = Array.from({ length: HOURS }, (_, hour) => hour);
  const days = Array.from({ length: DAYS }, (_, dow) => dow);

  const rows = days.flatMap((dow) => [
    <span key={`day-${dow}`} className={styles.heatDay}>
      {t(`costs.weekday${dow}`)}
    </span>,
    ...hours.map((hour) => (
      <i
        key={`cell-${dow}-${hour}`}
        className={styles.heatCell}
        data-tier={activityTier(grid[dow][hour], max)}
        data-testid={`heat-${dow}-${hour}`}
      />
    )),
  ]);

  return (
    <figure className={styles.card}>
      <h3 className={styles.title}>{t('costs.heatTitle')}</h3>
      <div className={styles.scroller}>
        <div className={styles.heat} aria-hidden="true">
          <span className={styles.heatDay} />
          {hours.map((hour) => (
            <span key={hour} className={styles.heatHour}>
              {hour % HOUR_STEP === 0 ? t('costs.hourLabel', { hour: pad(hour) }) : ''}
            </span>
          ))}
          {rows}
        </div>
      </div>
      <p className={styles.scale}>
        {t('costs.scaleLess')}
        {Array.from({ length: ACTIVITY_TIERS + 1 }, (_, tier) => (
          <span key={tier} className={styles.scaleStep} data-tier={tier} />
        ))}
        {t('costs.scaleMore')}
      </p>
      <figcaption className={max <= 0 ? styles.empty : styles.caption}>
        {max <= 0
          ? t('costs.noSpendRange')
          : t('costs.heatCaption', {
              day: t(`costs.weekday${peakDow}`),
              hour: pad(peakHour),
              cost: usd(max),
            })}
      </figcaption>
    </figure>
  );
}
