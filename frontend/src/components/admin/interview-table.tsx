'use client';

import type { ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { Link } from '../../i18n/navigation';
import type { AdminInterviewRow } from '../../lib/query';

import { SortHeader } from './sort-header';
import styles from './table.module.css';

/**
 * The row's own ceiling, now that `/admin/interviews` projects `budgetUsd`. This was a
 * hardcoded 0.50 against every row, which read the deployment's default rather than the
 * interview's — an interview created before `BUDGET_USD_TEXT` moved was measured against the
 * new ceiling and flagged at the wrong number.
 */
export function atCeiling(row: AdminInterviewRow): boolean {
  return microUsd(row.costUsd) >= microUsd(row.budgetUsd);
}

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
  sort,
  onSort,
  filter,
}: {
  items: AdminInterviewRow[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  sort: { field: string; dir: 'asc' | 'desc' };
  onSort: (field: string) => void;
  filter?: ReactNode;
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
        {filter ? <div className={styles.filter}>{filter}</div> : null}
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
                <SortHeader
                  field="account"
                  label={t('interviews.col.user')}
                  sort={sort}
                  onSort={onSort}
                />
                <SortHeader
                  field="occupation"
                  label={t('interviews.col.occupation')}
                  sort={sort}
                  onSort={onSort}
                />
                <SortHeader
                  field="state"
                  label={t('interviews.col.state')}
                  sort={sort}
                  onSort={onSort}
                />
                <th scope="col" className={styles.num}>
                  {t('interviews.col.tokens')}
                </th>
                <SortHeader
                  field="cost"
                  label={t('interviews.col.cost')}
                  sort={sort}
                  onSort={onSort}
                  numeric
                />
                <th scope="col">{t('interviews.col.flags')}</th>
                <th scope="col">
                  <span className={styles.srOnly}>{t('interviews.open')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const unpriced = isUnpriced(row);
                const ceiling = atCeiling(row);
                return (
                  <tr
                    key={row.id}
                    data-testid="admin-interview-row"
                    data-budget={ceiling ? 'ceiling' : undefined}
                  >
                    <td className={`${styles.id} tabular`} title={row.id}>
                      {row.id}
                    </td>
                    {/* The account, resolved. The row carried a bare cuid until
                        `/admin/interviews` learned to join it. */}
                    <td className={styles.occupation} title={row.userId}>
                      {row.userEmail}
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
                      {ceiling && (
                        <span className={styles.ceilingPill}>{t('interviews.ceilingPill')}</span>
                      )}
                    </td>
                    <td>
                      {/* US-26's "open one" — the drill-down the spec asked for and the row
                          never had. Labelled with the id so a screen reader hears which. */}
                      <Link
                        className={styles.open}
                        href={`/admin/interviews/${row.id}`}
                        aria-label={t('interviews.openRow', { id: row.id })}
                      >
                        {t('interviews.open')}
                      </Link>
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
