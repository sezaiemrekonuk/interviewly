'use client';

import { useTranslations } from 'next-intl';

import type { AdminInterviewRow, AdminStatsResponse } from '../../lib/query';
import { Meter } from '../shell/meter';
import { Spec } from '../shell/split-shell';

import { isUnpriced, microUsd } from './interview-table';
// Shares the Overview panel vocabulary (card, eyebrow, row, meter) rather than restating it.
import styles from './panels.module.css';

const usd = (micro: number) => (micro / 1_000_000).toFixed(6);

/**
 * Costs. There is no cost endpoint: `/admin/stats` returns no money at all, so every figure
 * here is summed from the interview rows currently loaded — which is what the copy says.
 *
 * The date range, the provider/model/mode filters and the per-model breakdown the design
 * calls for have no data source; they are drawn in the Spec state rather than faked, and the
 * unpriced rows are excluded from the total rather than counted as free.
 */
export function CostPanel({
  items,
  clusters,
}: {
  items: AdminInterviewRow[];
  clusters: AdminStatsResponse['perOccupation'];
}) {
  const t = useTranslations('admin');

  const priced = items.filter((row) => !isUnpriced(row));
  // Summed as integer micro-dollars: adding six-decimal strings as floats drifts, and this
  // is money on an audit surface.
  const totalMicro = priced.reduce((sum, row) => sum + microUsd(row.costUsd), 0);
  const unpricedCount = items.length - priced.length;

  // The only breakdown the two endpoints support: `occupationCluster` is on every row and
  // `/admin/stats` carries the readable label for each cluster key.
  const labels = new Map(clusters.map((entry) => [entry.cluster, entry.label]));
  const byCluster = new Map<string, number>();
  for (const row of priced) {
    const key = row.occupationCluster ?? '';
    byCluster.set(key, (byCluster.get(key) ?? 0) + microUsd(row.costUsd));
  }
  const clusterRows = [...byCluster.entries()]
    .map(([key, micro]) => ({
      key,
      label: labels.get(key) ?? (key || t('interviews.noOccupation')),
      micro,
    }))
    .sort((a, b) => b.micro - a.micro);
  const clusterMax = Math.max(1, ...clusterRows.map((row) => row.micro));

  return (
    <section className={styles.panel} aria-labelledby="admin-costs-heading">
      <h2 className={styles.srOnly} id="admin-costs-heading">
        {t('costs.heading')}
      </h2>

      <div>
        <div className={styles.filters}>
          <span className={styles.chip}>{t('filters.dateRange')}</span>
          <span className={styles.chip}>{t('filters.provider')}</span>
          <span className={styles.chip}>{t('filters.mode')}</span>
          <span className={styles.chip}>{t('filters.search')}</span>
          <Spec />
        </div>
        <p className={styles.rowNote}>{t('spec.filters')}</p>
      </div>

      <div className={styles.card}>
        <span className={styles.eyebrow}>{t('costs.total')}</span>
        <p className={`${styles.big} tabular`}>{usd(totalMicro)}</p>
        <p className={styles.note}>{t('costs.totalNote', { count: items.length })}</p>
        {unpricedCount > 0 ? (
          <p className={styles.note}>{t('costs.unpricedNote', { count: unpricedCount })}</p>
        ) : null}
      </div>

      <div className={styles.card}>
        <h3 className={styles.title}>{t('costs.byCluster')}</h3>
        {clusterRows.length === 0 ? (
          <p className={styles.empty}>{t('costs.noSpend')}</p>
        ) : (
          <ul className={styles.rows}>
            {clusterRows.map((row) => (
              <li className={styles.row} key={row.key}>
                <span className={styles.rowLabel}>{row.label}</span>
                <span className={`${styles.rowValue} tabular`}>{usd(row.micro)}</span>
                <Meter className={styles.rowMeter} value={row.micro} max={clusterMax} decorative />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.card}>
        <h3 className={styles.title}>{t('costs.byModel')}</h3>
        <div className={styles.hatch}>
          <p className={styles.hatchNote}>{t('spec.byModel')}</p>
        </div>
      </div>
    </section>
  );
}
