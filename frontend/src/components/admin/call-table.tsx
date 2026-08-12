'use client';

import type { ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import type { AdminCallRow } from '../../lib/query';

import { SortHeader } from './sort-header';
import styles from './table.module.css';

/** A uuid at full width would own the column; eight characters identify it and `title` holds the rest. */
const UUID_HEAD = 8;

export function CallTable({
  items,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  showInterview = false,
  sort,
  onSort,
  filter,
}: {
  items: AdminCallRow[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  showInterview?: boolean;
  sort: { field: string; dir: 'asc' | 'desc' };
  onSort: (field: string) => void;
  filter?: ReactNode;
}) {
  const t = useTranslations('admin');
  const format = useFormatter();

  // `unit_kind` arrives as a plain string; the message tree is typed. An unmapped kind prints
  // its own name rather than leaving the number bare.
  const unitLabel = (unitKind: string) => {
    const key = `calls.unit.${unitKind}` as Parameters<typeof t.has>[0];
    return t.has(key) ? t(key) : unitKind;
  };

  return (
    <section className={styles.card} aria-labelledby="admin-calls-heading">
      <div className={styles.head}>
        <h2 className={styles.heading} id="admin-calls-heading">
          {t('calls.heading')}
        </h2>
        <p className={styles.note}>{t('calls.note')}</p>
        {filter ? <div className={styles.filter}>{filter}</div> : null}
      </div>

      {items.length === 0 ? (
        <p className={styles.empty} data-testid="admin-table-empty">
          {t('calls.empty')}
        </p>
      ) : (
        <div className={styles.scroller}>
          <table className={styles.table}>
            <caption className={styles.caption}>{t('calls.caption')}</caption>
            <thead>
              <tr>
                <SortHeader
                  field="created"
                  label={t('calls.col.when')}
                  sort={sort}
                  onSort={onSort}
                />
                {showInterview && <th scope="col">{t('calls.col.interview')}</th>}
                <SortHeader
                  field="provider"
                  label={t('calls.col.provider')}
                  sort={sort}
                  onSort={onSort}
                />
                <SortHeader
                  field="model"
                  label={t('calls.col.model')}
                  sort={sort}
                  onSort={onSort}
                />
                <SortHeader
                  field="version"
                  label={t('calls.col.prompt')}
                  sort={sort}
                  onSort={onSort}
                />
                <th scope="col" className={styles.num}>
                  {t('calls.col.units')}
                </th>
                <th scope="col" className={styles.num}>
                  {t('calls.col.tokens')}
                </th>
                <SortHeader
                  field="cost"
                  label={t('calls.col.cost')}
                  sort={sort}
                  onSort={onSort}
                  numeric
                />
                <SortHeader
                  field="latency"
                  label={t('calls.col.latency')}
                  sort={sort}
                  onSort={onSort}
                  numeric
                />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                // Both halves or neither: one null side would print as the other side's total.
                const tokens =
                  row.inputTokens === null || row.outputTokens === null
                    ? null
                    : row.inputTokens + row.outputTokens;
                return (
                  <tr key={row.id} data-testid="admin-call-row">
                    <td className="tabular">
                      {format.dateTime(new Date(row.createdAt), {
                        dateStyle: 'short',
                        timeStyle: 'medium',
                      })}
                    </td>
                    {showInterview && (
                      <td className={`${styles.id} tabular`} title={row.interviewId}>
                        {row.interviewId}
                      </td>
                    )}
                    <td>{row.provider}</td>
                    <td className={styles.occupation}>{row.model}</td>
                    <td className={styles.flags}>
                      {row.promptUuid === '' ? (
                        <span className="tabular">—</span>
                      ) : (
                        <>
                          <span className="tabular" title={row.promptUuid}>
                            {row.promptUuid.slice(0, UUID_HEAD)}
                          </span>
                          <span className={styles.pill}>
                            {t('calls.promptVersion', { version: row.promptVersion })}
                          </span>
                        </>
                      )}
                      {row.attemptNo > 1 && (
                        <span className={styles.pill}>
                          {t('calls.attempt', { n: row.attemptNo })}
                        </span>
                      )}
                      {row.fellBackFrom && (
                        <span className={styles.pill}>
                          {t('calls.fellBack', { model: row.fellBackFrom })}
                        </span>
                      )}
                    </td>
                    <td className={`${styles.num} tabular`}>
                      {row.units} {unitLabel(row.unitKind)}
                    </td>
                    <td className={`${styles.num} tabular`}>
                      {tokens === null ? '—' : format.number(tokens)}
                    </td>
                    {/* The backend's six-decimal string (K11) — printed, never re-rounded. */}
                    <td className={`${styles.num} tabular`}>{row.costUsd}</td>
                    <td className={`${styles.num} tabular`}>
                      {t('calls.latency', { ms: row.latencyMs })}
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
