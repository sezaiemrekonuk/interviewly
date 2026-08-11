'use client';

import { useTranslations } from 'next-intl';

import styles from './sort-header.module.css';
import tableStyles from './table.module.css';

/**
 * One sortable column heading — the whole `<th>`, so no caller can ship the button without
 * `aria-sort` beside it. Without that attribute a screen reader user cannot tell a sorted
 * table from an unsorted one, and the arrow is the only other evidence.
 */
export function SortHeader({
  field,
  label,
  sort,
  onSort,
  numeric,
}: {
  /** The backend's sort key, e.g. 'created' — NOT the column name. */
  field: string;
  label: string;
  sort: { field: string; dir: 'asc' | 'desc' };
  /** Called with `field`; the caller flips direction when it is already the active field. */
  onSort: (field: string) => void;
  numeric?: boolean;
}) {
  const t = useTranslations('admin');
  const active = sort.field === field;
  const ascending = active && sort.dir === 'asc';

  return (
    <th
      scope="col"
      className={numeric ? tableStyles.num : undefined}
      aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className={[styles.sort, numeric ? styles.sortNumeric : null].filter(Boolean).join(' ')}
        data-testid={`admin-sort-${field}`}
        onClick={() => onSort(field)}
      >
        {/* The name says what pressing does; the visible label is hidden from it so the two
            do not read as one stuttered phrase. No `aria-label`, because that would replace
            the contents wholesale and swallow the state line below. */}
        <span className={tableStyles.srOnly}>{t('sort.by', { label })}</span>
        <span aria-hidden="true">{label}</span>
        {active ? (
          <span className={tableStyles.srOnly}>
            {t('sort.active', { label, dir: t(ascending ? 'sort.asc' : 'sort.desc') })}
          </span>
        ) : null}

        {/* Geometry in `points`, not a CSS transform on one glyph: the CSP is
            `style-src 'self' 'nonce-…'`, and a rotated shared arrow is a style attribute
            away from being silently dropped in production. Both triangles always draw, so
            an unsorted column still advertises that it can be sorted. */}
        <svg
          className={styles.arrow}
          viewBox="0 0 10 14"
          width="10"
          height="14"
          aria-hidden="true"
          focusable="false"
        >
          <polygon points="5,1 9,6 1,6" className={ascending ? styles.on : styles.off} />
          <polygon
            points="5,13 9,8 1,8"
            className={active && !ascending ? styles.on : styles.off}
          />
        </svg>
      </button>
    </th>
  );
}
