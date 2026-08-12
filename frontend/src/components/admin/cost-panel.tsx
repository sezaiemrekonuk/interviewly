'use client';

import { useTranslations } from 'next-intl';

import type { AdminInterviewRow, AdminStatsResponse } from '../../lib/query';
import { Meter } from '../shell/meter';

import { isUnpriced, microUsd } from './interview-table';
// Shares the Overview panel vocabulary (card, eyebrow, row, meter) rather than restating it.
import styles from './panels.module.css';

const usd = (micro: number) => (micro / 1_000_000).toFixed(6);

/**
 * Costs.
 *
 * The platform total and the per-model breakdown now come from `/admin/stats` — `totalCostUsd`
 * and `perModel[]`, both aggregated in Postgres over every `llm_calls` row. What was here
 * before summed whatever interviews the table had paged in and said so out loud, because there
 * was no endpoint that knew the platform figure.
 *
 * The per-CLUSTER breakdown is still summed client-side from the loaded rows, and that is not
 * an oversight: `perOccupation[]` counts interviews, not dollars, so cluster spend has no
 * server-side source. It is labelled as loaded-rows-only for the same reason the total used
 * to be.
 *
 * Voice rolls into the same money. It is charged per second rather than per token, so it has
 * no token count to appear under — the drill-down's `unitKind` column is where the two split.
 */
export function CostPanel({
  items,
  stats,
}: {
  items: AdminInterviewRow[];
  stats: AdminStatsResponse | undefined;
}) {
  const t = useTranslations('admin');

  const priced = items.filter((row) => !isUnpriced(row));
  const unpricedCount = items.length - priced.length;

  const labels = new Map((stats?.perOccupation ?? []).map((entry) => [entry.cluster, entry.label]));
  // Summed as integer micro-dollars: adding six-decimal strings as floats drifts, and this
  // is money on an audit surface.
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

  const models = stats?.perModel ?? [];
  const modelMax = Math.max(1, ...models.map((row) => microUsd(row.costUsd)));

  return (
    <section className={styles.panel} aria-labelledby="admin-costs-heading">
      <h2 className={styles.srOnly} id="admin-costs-heading">
        {t('costs.heading')}
      </h2>

      <div className={styles.card} data-testid="admin-platform-spend">
        <span className={styles.eyebrow}>{t('costs.platformTotal')}</span>
        {/* The backend's six-decimal string, printed. Re-rounding a ledger figure in the
            client is how two screens come to disagree about what something cost. */}
        <p className={`${styles.big} tabular`}>{stats?.totalCostUsd ?? '0.000000'}</p>
        <p className={styles.note}>{t('costs.platformTotalNote')}</p>
        {unpricedCount > 0 ? (
          <p className={styles.note}>{t('costs.unpricedNote', { count: unpricedCount })}</p>
        ) : null}
      </div>

      <div className={styles.card} data-testid="admin-by-model">
        <h3 className={styles.title}>{t('costs.byModel')}</h3>
        <p className={styles.note}>{t('costs.byModelCaption')}</p>
        {models.length === 0 ? (
          <p className={styles.empty}>{t('costs.noSpend')}</p>
        ) : (
          <ul className={styles.rows}>
            {models.map((row) => (
              <li className={styles.row} key={`${row.provider}:${row.model}`}>
                <span className={styles.rowLabel}>
                  {row.provider} · {row.model}
                </span>
                <span className={`${styles.rowValue} tabular`}>{row.costUsd}</span>
                <Meter
                  className={styles.rowMeter}
                  value={microUsd(row.costUsd)}
                  max={modelMax}
                  decorative
                />
                <span className={styles.rowNote}>
                  {t('costs.modelCalls', { count: row.calls })} ·{' '}
                  {t('costs.modelLatency', { ms: row.averageLatencyMs })}
                </span>
              </li>
            ))}
          </ul>
        )}
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
        <p className={styles.note}>{t('costs.totalNote', { count: items.length })}</p>
      </div>
    </section>
  );
}
