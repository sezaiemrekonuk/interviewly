'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  type AdminInterviewRow,
  type AdminStatsResponse,
  type CostRange,
  useAdminCosts,
} from '../../lib/query';
import { useErrorMessage } from '../../lib/use-error-message';
import { Meter } from '../shell/meter';

import { ChartPanel } from './charts/chart-panel';
import chartStyles from './charts/charts.module.css';
import { ModelTable } from './charts/model-table';
import { isUnpriced, microUsd } from './interview-table';
import styles from './panels.module.css';

const usd = (micro: number) => (micro / 1_000_000).toFixed(6);

const SKELETONS = ['chart', 'table'];

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
  const errorMessage = useErrorMessage();
  const [days, setDays] = useState<CostRange>(30);
  const costs = useAdminCosts(true, days);

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

  const data = costs.data;
  const windowMicro = data ? microUsd(data.totals.costUsd) : 0;
  const previousMicro = data ? microUsd(data.previous.costUsd) : 0;
  const deltaPercent =
    previousMicro === 0 ? null : Math.round(((windowMicro - previousMicro) / previousMicro) * 100);
  const perInterview =
    data && data.totals.interviews > 0 ? windowMicro / data.totals.interviews : 0;

  return (
    <section className={styles.panel} aria-labelledby="admin-costs-heading">
      <h2 className={styles.srOnly} id="admin-costs-heading">
        {t('costs.heading')}
      </h2>

      <div className={styles.figures}>
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

        <div className={styles.card} data-testid="admin-window-spend">
          <span className={styles.eyebrow}>{t('costs.windowSpend')}</span>
          <p className={`${styles.big} tabular`}>{data?.totals.costUsd ?? '0.000000'}</p>
          <p className={styles.note}>{t('costs.windowSpendNote')}</p>
          <p
            className={chartStyles.delta}
            data-direction={
              deltaPercent === null ? undefined : deltaPercent > 0 ? 'up' : deltaPercent < 0 ? 'down' : undefined
            }
          >
            {deltaPercent === null
              ? t('costs.windowDeltaNone')
              : t('costs.windowDelta', { percent: deltaPercent, days })}
          </p>
        </div>

        <div className={styles.card} data-testid="admin-cost-per-interview">
          <span className={styles.eyebrow}>{t('costs.perInterview')}</span>
          <p className={`${styles.big} tabular`}>{usd(perInterview)}</p>
          <p className={styles.note}>{t('costs.perInterviewNote')}</p>
        </div>
      </div>

      {costs.error ? (
        <p className={styles.empty} role="alert">
          {errorMessage(costs.error.code)}
        </p>
      ) : null}

      {data ? (
        <>
          <ChartPanel data={data} days={days} onDaysChange={setDays} />
          <ModelTable data={data} />
        </>
      ) : costs.error ? null : (
        SKELETONS.map((id) => (
          <div className={chartStyles.skeleton} key={id} data-testid="admin-cost-loading" />
        ))
      )}

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
