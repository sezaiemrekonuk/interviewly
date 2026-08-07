'use client';

import { useFormatter, useTranslations } from 'next-intl';

import type { AdminInterviewRow } from '../../lib/query';

import styles from './interview-table.module.css';

/**
 * `interviews.budget_usd` defaults to 0.50 in the schema and `BUDGET_USD_TEXT` can move it
 * per deployment, but `/admin/interviews` does not project it — so the default is what the
 * console can honestly compare against.
 * ponytail: constant; read the row's own ceiling once the endpoint returns `budgetUsd`.
 */
const CEILING_MICRO = 500_000;

/** Six-decimal string → integer micro-dollars, so a page of costs sums without float drift. */
export function microUsd(costUsd: string): number {
  const [whole, frac = ''] = costUsd.split('.');
  const dollars = Number.parseInt(whole || '0', 10);
  const micros = Number.parseInt(frac.padEnd(6, '0').slice(0, 6) || '0', 10);
  return dollars * 1_000_000 + micros;
}

/**
 * `llm_calls.cost_usd` is NOT NULL and stores 0 when the model has no price row, which is
 * indistinguishable from free. A row that burned tokens and cost nothing is unpriced; a row
 * that burned nothing has simply not spent yet, and 0.000000 is the truth there.
 */
export function isUnpriced(row: AdminInterviewRow): boolean {
  return microUsd(row.costUsd) === 0 && row.totalTokens > 0;
}

/** States where the interview is still running — the one place --live is earned here. */
const LIVE_STATES = new Set(['profiling', 'hr_round', 'tech_round', 'evaluating']);

export function InterviewTable({
  items,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  items: AdminInterviewRow[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  const t = useTranslations('admin');
  const format = useFormatter();

  // A state arrives over the wire as a plain string; the message tree is typed. An
  // unmapped state prints its own name rather than leaving the cell blank.
  const stateLabel = (state: string) => {
    const key = `state.${state}` as Parameters<typeof t.has>[0];
    return t.has(key) ? t(key) : state;
  };

  return (
    <section className={styles.card} aria-labelledby="admin-interviews-heading">
      <div className={styles.head}>
        <h2 className={styles.heading} id="admin-interviews-heading">
          {t('interviews.heading')}
        </h2>
        {/* The projection carries a raw `userId` cuid and nothing else — no email, no name,
            and no endpoint to resolve it. Printing the cuid would look like an answer. */}
        <p className={styles.note}>{t('interviews.noUserJoin')}</p>
      </div>

      {items.length === 0 ? (
        <p className={styles.empty} data-testid="admin-table-empty">
          {t('interviews.empty')}
        </p>
      ) : (
        <div className={styles.scroller}>
          <table className={styles.table}>
            <caption className={styles.caption}>{t('interviews.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('interviews.col.id')}</th>
                <th scope="col">{t('interviews.col.occupation')}</th>
                <th scope="col">{t('interviews.col.state')}</th>
                <th scope="col" className={styles.num}>
                  {t('interviews.col.tokens')}
                </th>
                <th scope="col" className={styles.num}>
                  {t('interviews.col.cost')}
                </th>
                <th scope="col">{t('interviews.col.flags')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const unpriced = isUnpriced(row);
                const atCeiling = microUsd(row.costUsd) >= CEILING_MICRO;
                return (
                  <tr
                    key={row.id}
                    data-testid="admin-interview-row"
                    data-budget={atCeiling ? 'ceiling' : undefined}
                  >
                    <td className={`${styles.id} tabular`} title={row.id}>
                      {row.id}
                    </td>
                    <td className={styles.occupation}>
                      {row.occupation ?? t('interviews.noOccupation')}
                    </td>
                    <td>
                      <span
                        className={styles.pill}
                        data-live={LIVE_STATES.has(row.state) || undefined}
                      >
                        {stateLabel(row.state)}
                      </span>
                    </td>
                    <td className={`${styles.num} tabular`}>{format.number(row.totalTokens)}</td>
                    <td className={styles.num} data-cost={unpriced ? 'unknown' : undefined}>
                      {unpriced ? (
                        t('interviews.unpriced')
                      ) : (
                        /* The backend's six-decimal string (K11) — printed, never re-rounded. */
                        <span className="tabular">{row.costUsd}</span>
                      )}
                    </td>
                    <td className={styles.flags}>
                      {row.deleted && (
                        <span className={styles.deletedPill}>{t('interviews.deletedPill')}</span>
                      )}
                      {atCeiling && (
                        <span className={styles.ceilingPill}>{t('interviews.ceilingPill')}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {hasNextPage && (
        <div className={styles.footer}>
          <button
            className={styles.loadMore}
            type="button"
            disabled={isFetchingNextPage}
            onClick={onLoadMore}
          >
            {t('interviews.loadMore')}
          </button>
        </div>
      )}
    </section>
  );
}
