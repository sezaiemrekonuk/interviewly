import type { ReactNode } from 'react';

import { Link } from '../../i18n/navigation';
import styles from './shell.module.css';

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

/**
 * The one layout. Left column is context and state, right is the work — on every screen,
 * so the product is learned once instead of per page.
 *
 * `width` is a variant rather than a number because the CSP (`style-src 'self' 'nonce-…'`)
 * drops style attributes in production; a rail sized inline would collapse to zero there.
 */
export function SplitShell({
  rail,
  width = 'default',
  className,
  children,
}: {
  rail: ReactNode;
  width?: 'narrow' | 'default' | 'wide';
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx(styles.shell, styles[width], className)}>
      <aside className={styles.rail}>{rail}</aside>
      <main id="content" tabIndex={-1} className={styles.work}>{children}</main>
    </div>
  );
}

/**
 * The wordmark. The glyph is drawn from currentColor — no asset, no second request.
 *
 * `href`, when given, makes it a way back to the marketing home — `/` redirects a signed-in
 * visitor straight back to their briefing (`home-switch.tsx`), so every rail can point here
 * without knowing whether the visitor underneath it is signed in.
 */
export function RailMark({ label = 'Interviewly', href }: { label?: string; href?: string }) {
  const mark = (
    <div className={styles.mark}>
      <span className={styles.markGlyph} aria-hidden="true" />
      <span className={styles.markText}>{label}</span>
    </div>
  );
  if (!href) return mark;
  return (
    <Link href={href} className={styles.markLink}>
      {mark}
    </Link>
  );
}

/** A labelled fact on the rail: what is true right now. */
export function RailBlock({
  label,
  note,
  children,
}: {
  label: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={styles.block}>
      <span className={styles.label}>{label}</span>
      {children}
      {note ? <p className={styles.note}>{note}</p> : null}
    </div>
  );
}

export function RailValue({ children }: { children: ReactNode }) {
  return <span className={styles.value}>{children}</span>;
}

/** Pinned to the bottom of the rail: identity, connection, whatever is ambient. */
export function RailFoot({ children }: { children: ReactNode }) {
  return <div className={styles.foot}>{children}</div>;
}

/** The working surface's own header — the subject of this screen, plus its controls. */
export function WorkTop({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className={styles.workTop}>
      <h1 className={styles.workTitle}>{title}</h1>
      {children}
    </div>
  );
}

export function WorkBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx(styles.workBody, className)}>{children}</div>;
}

/**
 * "Specified, not yet built." Deliberately neutral — several parts of the admin console are
 * waiting on backend work, and colouring a scheduled gap as a failure teaches the operator to
 * ignore the failures that matter.
 */
export function Spec({ onRail = false }: { onRail?: boolean }) {
  return <span className={cx(styles.spec, onRail && styles.specOnRail)}>Spec</span>;
}
