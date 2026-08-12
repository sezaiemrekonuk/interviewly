'use client';

import type { ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { Link } from '../../i18n/navigation';
import type { AdminAuditRow } from '../../lib/query';

import { SortHeader } from './sort-header';
import styles from './table.module.css';

/**
 * The audit trail. Same shape as `interview-table.tsx` — this surface has one table idiom
 * and a second one would only teach the operator that two tables mean two things.
 */
export function AuditTable({
  items,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  sort,
  onSort,
  filter,
}: {
  items: AdminAuditRow[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  sort: { field: string; dir: 'asc' | 'desc' };
  onSort: (field: string) => void;
  filter?: ReactNode;
}) {
  const t = useTranslations('admin');
  const format = useFormatter();

  // The wire value is a dotted name (`interview.soft_deleted`); a message key cannot hold a
  // dot, so the tree stores `interview_soft_deleted`. An action the backend gained since the
  // last translation pass prints its own name rather than leaving the cell blank.
  const actionLabel = (action: string) => {
    const key = `audit.action.${action.replaceAll('.', '_')}` as Parameters<typeof t.has>[0];
    return t.has(key) ? t(key) : action;
  };

  return (
    <section className={styles.card} aria-labelledby="admin-audit-heading">
      <div className={styles.head}>
        <h2 className={styles.heading} id="admin-audit-heading">
          {t('audit.heading')}
        </h2>
        <p className={styles.note}>{t('audit.note')}</p>
        {filter ? <div className={styles.filter}>{filter}</div> : null}
      </div>

      {items.length === 0 ? (
        <p className={styles.empty} data-testid="admin-audit-empty">
          {t('audit.empty')}
        </p>
      ) : (
        <div className={styles.scroller}>
          <table className={styles.table}>
            <caption className={styles.caption}>{t('audit.caption')}</caption>
            <thead>
              <tr>
                <SortHeader
                  field="created"
                  label={t('audit.col.when')}
                  sort={sort}
                  onSort={onSort}
                />
                <SortHeader
                  field="action"
                  label={t('audit.col.action')}
                  sort={sort}
                  onSort={onSort}
                />
                <SortHeader
                  field="actor"
                  label={t('audit.col.actor')}
                  sort={sort}
                  onSort={onSort}
                />
                <th scope="col">{t('audit.col.subject')}</th>
                <th scope="col">{t('audit.col.trace')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} data-testid="admin-audit-row">
                  <td className="tabular">
                    {format.dateTime(new Date(row.createdAt), {
                      dateStyle: 'short',
                      timeStyle: 'medium',
                    })}
                  </td>
                  <td>{actionLabel(row.action)}</td>
                  {/* `.flags` is the one rule that spaces two inline things inside a cell
                      without making the <td> a flex box, which drops it out of the table's
                      column algorithm. */}
                  <td className={styles.flags}>
                    <span>{row.actorEmail}</span>
                    <span className={styles.pill}>{row.actorRole}</span>
                  </td>
                  <td className={styles.flags}>
                    <span className={styles.pill}>{row.subjectType}</span>
                    {row.subjectId === null ? (
                      <span>{t('audit.noSubject')}</span>
                    ) : (
                      <span className="tabular" title={row.subjectId}>
                        {row.subjectType === 'interview' ? (
                          <Link href={`/admin/interviews/${row.subjectId}`}>{row.subjectId}</Link>
                        ) : (
                          row.subjectId
                        )}
                      </span>
                    )}
                  </td>
                  {/* The id that ties this row to the request log: truncated in the cell,
                      whole in the title, because it is a thing an operator copies. */}
                  <td className={`${styles.id} tabular`} title={row.traceId ?? undefined}>
                    {row.traceId ?? '—'}
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
