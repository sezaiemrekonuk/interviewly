'use client';

import { useFormatter, useTranslations } from 'next-intl';

import type { AdminInterviewRow } from '../../lib/query';

import styles from './interview-table.module.css';

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
      <h2 className={styles.heading} id="admin-interviews-heading">
        {t('interviews.heading')}
      </h2>

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
              {items.map((row) => (
                <tr key={row.id} data-testid="admin-interview-row">
                  <td className={styles.occupation}>
                    {row.occupation ?? t('interviews.noOccupation')}
                  </td>
                  <td>{stateLabel(row.state)}</td>
                  <td className={styles.num}>{format.number(row.totalTokens)}</td>
                  {/* The backend's six-decimal string (K11) — printed, never re-rounded. */}
                  <td className={styles.num}>{row.costUsd}</td>
                  <td>
                    {row.deleted && (
                      <span className={styles.deletedPill}>{t('interviews.deletedPill')}</span>
                    )}
                  </td>
                </tr>
              ))}
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
