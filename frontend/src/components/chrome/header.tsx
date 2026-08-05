import Link from 'next/link';

import { LocaleSwitcher } from '../locale-switcher';

import styles from './chrome.module.css';
import { HeaderNav } from './header-nav';

/**
 * Wordmark left, controls right, transparent over whatever ground the route paints. It is
 * deliberately absent from the interview room (full-bleed, the face is the subject) and
 * from the `(auth)`/`(onboarding)` groups, which are pre-app-shell by design.
 */
export function SiteHeader() {
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.wordmark}>
        Interviewly
      </Link>
      <nav className={styles.nav}>
        <HeaderNav />
        <LocaleSwitcher />
      </nav>
    </header>
  );
}
