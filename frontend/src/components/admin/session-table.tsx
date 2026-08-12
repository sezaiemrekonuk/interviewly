'use client';

import type { ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import type { AdminSessionRow } from '../../lib/query';

import { SortHeader } from './sort-header';
import styles from './table.module.css';

export function SessionTable({
  items,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  sort,
  onSort,
  filter,
}: {
  items: AdminSessionRow[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  sort: { field: string; dir: 'asc' | 'desc' };
  onSort: (field: string) => void;
  filter?: ReactNode;
}) {
  const t = useTranslations('admin');
  const format = useFormatter();

  return (
    <section className={styles.card} aria-labelledby="admin-sessions-heading">
      <div className={styles.head}>
        <h2 className={styles.heading} id="admin-sessions-heading">
          {t('sessions.heading')}
        </h2>
        <p className={styles.note}>{t('sessions.note')}</p>
        {filter ? <div className={styles.filter}>{filter}</div> : null}
      </div>

      {items.length === 0 ? (
        <p className={styles.empty} data-testid="admin-table-empty">
          {t('sessions.empty')}
        </p>
      ) : (
        <div className={styles.scroller}>
          <table className={styles.table}>
            <caption className={styles.caption}>{t('sessions.caption')}</caption>
            <thead>
              <tr>
                <SortHeader
                  field="email"
                  label={t('sessions.col.user')}
                  sort={sort}
                  onSort={onSort}
                />
                <th scope="col">{t('sessions.col.status')}</th>
                <SortHeader
                  field="created"
                  label={t('sessions.col.created')}
                  sort={sort}
                  onSort={onSort}
                />
                <SortHeader
                  field="expires"
                  label={t('sessions.col.expires')}
                  sort={sort}
                  onSort={onSort}
                />
              </tr>
            </thead>
            <tbody>
              {items.map((session) => {
                // `active` is the server's answer: revoked outranks it, and a row that is
                // neither revoked nor active has simply run out its expiry.
                const status = session.revokedAt
                  ? t('sessions.revoked')
                  : session.active
                    ? t('sessions.active')
                    : t('sessions.expired');
                return (
                  <tr key={session.id} data-testid="admin-session-row">
                    <td className={styles.occupation} title={session.userEmail}>
                      {session.userEmail}
                    </td>
                    <td>
                      <span
                        className={styles.pill}
                        data-live={(!session.revokedAt && session.active) || undefined}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="tabular">
                      {format.dateTime(new Date(session.createdAt), {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="tabular">
                      {format.dateTime(new Date(session.expiresAt), {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
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
