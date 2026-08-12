'use client';

import { useEffect, useState } from 'react';

import { Link } from '../../i18n/navigation';
import styles from './chrome.module.css';
import { HeaderNav } from './header-nav';

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

/**
 * Wordmark left, controls right — sticky over whatever ground the route paints, with one
 * hairline underneath it so the chrome still ends where the working surface begins. Transparent
 * at rest, so it doesn't invent a ground over the hero; once the page has scrolled past it, a
 * translucent, blurred ground rides in underneath so text scrolling past the bar doesn't run
 * straight through the wordmark and nav.
 *
 * Deliberately absent from the interview room (full-bleed, the face is the subject), from
 * `/admin` (the split shell carries its own rail mark) and from the `(auth)`/`(onboarding)`
 * groups, which are pre-app-shell by design.
 *
 * No locale switcher here for now — English only while the landing copy is in flux; it still
 * lives on `/settings` for a signed-in user who wants Turkish.
 */
export function SiteHeader({ onDark = false }: { onDark?: boolean } = {}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // A few px of tolerance: the header shouldn't flip its ground for a 1px rubber-band
    // scroll at the very top.
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={cx(styles.header, onDark && styles.headerOnDark, scrolled && styles.headerScrolled)}>
      <div className={styles.headerInner}>
        <Link href="/" className={styles.wordmark}>
          Interviewly
        </Link>
        <nav className={styles.nav}>
          <HeaderNav />
        </nav>
      </div>
    </header>
  );
}
