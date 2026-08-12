'use client';

import type { ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import type { AdminUserRow } from '../../lib/query';

import { SortHeader } from './sort-header';
import styles from './table.module.css';

export function UserTable({
  items,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onFilterByUser,
  sort,
  onSort,
  filter,
}: {
  items: AdminUserRow[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onFilterByUser?: (userId: string) => void;
  sort: { field: string; dir: 'asc' | 'desc' };
  onSort: (field: string) => void;
  filter?: ReactNode;
}) {
  const t = useTranslations('admin');
  const format = useFormatter();

  return (
    <section className={styles.card} aria-labelledby="admin-users-heading">
      <div className={styles.head}>
        <h2 className={styles.heading} id="admin-users-heading">
          {t('users.heading')}
        </h2>
        {filter ? <div className={styles.filter}>{filter}</div> : null}
      </div>

      {items.length === 0 ? (
        <p className={styles.empty} data-testid="admin-table-empty">
          {t('users.empty')}
        </p>
      ) : (
        <div className={styles.scroller}>
          <table className={styles.table}>
            <caption className={styles.caption}>{t('users.caption')}</caption>
            <thead>
              <tr>
                <SortHeader
                  field="email"
                  label={t('users.col.email')}
                  sort={sort}
                  onSort={onSort}
                />
                <SortHeader
                  field="role"
                  label={t('users.col.role')}
                  sort={sort}
                  onSort={onSort}
                />
                <SortHeader
                  field="interviews"
                  label={t('users.col.interviews')}
                  sort={sort}
                  onSort={onSort}
                  numeric
                />
                <th scope="col">{t('users.col.status')}</th>
                <SortHeader
                  field="created"
                  label={t('users.col.created')}
                  sort={sort}
                  onSort={onSort}
                />
              </tr>
            </thead>
            <tbody>
              {items.map((user) => (
                <tr key={user.id} data-testid="admin-user-row">
                  <td className={styles.occupation} title={user.email}>
                    {user.email}
                  </td>
                  <td>
                    <span className={styles.pill}>
                      {user.role === 'admin' ? t('users.role.admin') : t('users.role.user')}
                    </span>
                  </td>
                  <td className={`${styles.num} tabular`}>
                    {onFilterByUser ? (
                      <button
                        className={styles.pill}
                        type="button"
                        onClick={() => onFilterByUser(user.id)}
                      >
                        {format.number(user.interviewCount)}
                      </button>
                    ) : (
                      format.number(user.interviewCount)
                    )}
                  </td>
                  <td className={styles.flags}>
                    <span className={styles.pill}>
                      {user.emailVerified ? t('users.verified') : t('users.unverified')}
                    </span>
                    {user.onboarded && <span className={styles.pill}>{t('users.onboarded')}</span>}
                    {user.erased && (
                      <span className={styles.deletedPill}>{t('users.erased')}</span>
                    )}
                    <span className={styles.pill}>
                      {user.consentVersion
                        ? t('users.consent', { version: user.consentVersion })
                        : t('users.noConsent')}
                    </span>
                  </td>
                  <td className="tabular">
                    {format.dateTime(new Date(user.createdAt), { dateStyle: 'short' })}
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
