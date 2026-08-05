import type { SelectHTMLAttributes } from 'react';

import styles from './ui.module.css';

/**
 * A native `<select>` with the platform arrow suppressed and our own chevron drawn beside
 * it. Never a JS dropdown: the native control already ships keyboard handling, mobile
 * pickers and screen-reader semantics that a div-with-listeners has to re-earn.
 */
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={styles.selectWrap}>
      <select
        {...rest}
        className={[styles.control, styles.select, className].filter(Boolean).join(' ')}
      >
        {children}
      </select>
      <svg
        className={styles.chevron}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M4 6.5 8 10.5 12 6.5" />
      </svg>
    </span>
  );
}
