import Link from 'next/link';

import { LocaleSwitcher } from '../locale-switcher';

import styles from './chrome.module.css';
import { HeaderNav } from './header-nav';

/**
 * Wordmark left, controls right, transparent over whatever ground the route paints — with
 * one hairline underneath it, so the chrome ends where the working surface begins instead
 * of floating in it. The bar is full-bleed and the row inside it carries the page gutter:
 * the rule crosses the viewport, the wordmark lines up with the headline below it.
 *
 * Deliberately absent from the interview room (full-bleed, the face is the subject), from
 * `/admin` (the split shell carries its own rail mark) and from the `(auth)`/`(onboarding)`
 * groups, which are pre-app-shell by design.
 */
export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href="/" className={styles.wordmark}>
          Interviewly
        </Link>
        <nav className={styles.nav}>
          <HeaderNav />
          <LocaleSwitcher />
        </nav>
      </div>
    </header>
  );
}
