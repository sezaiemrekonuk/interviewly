'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Link, usePathname } from '../../i18n/navigation';
import { firstRunPath } from '../../lib/first-run';
import { probeSession } from '../../lib/session-probe';
import type { SessionUser } from '../../lib/use-require-auth';

import styles from './chrome.module.css';

/** In document order, so the header reads the same sequence a visitor scrolls through. */
const SECTIONS = ['demo', 'mechanism', 'modes', 'report', 'faq'] as const;

/**
 * The site header's actions, which now render on exactly three routes: the marketing landing
 * and the two legal pages. Everywhere else the rail carries navigation
 * (`components/shell/app-rail.tsx`), including sign-out — the control this file used to
 * explain the absence of.
 *
 * Deliberately *not* `useMe()`: this renders on the anonymous landing, and pulling React Query
 * into that tree spends the §8.1 JS budget on one lookup. A refused `/me` is not an error
 * here — the links simply keep their signed-out destinations. The probe is the shared one in
 * `lib/session-probe.ts` (issue 130).
 *
 * The same two actions, with the same two labels, whatever the session — only where they lead
 * changes. That is what retired the tri-state of issue 95: the labels no longer differ by
 * session, so there is no wrong doorway left to flash and nothing has to wait for `/me`. The
 * links paint with the signed-out hrefs and re-point when the probe answers. The signed-in
 * destination is `firstRunPath`, not a constant, so a visitor who never finished onboarding is
 * sent there instead of to a signed-in home they cannot use yet (issue 80).
 *
 * "Try now" is bordered rather than `--primary` because the landing hero already spends the
 * page's one CTA colour above the fold (DESIGN §2 rule 1).
 *
 * The section anchors are landing-only (plain `#id` links, no JS scroll library — the
 * platform's own anchor scrolling plus `scroll-behavior: smooth` in `globals.css` does this),
 * so they are gated on the route rather than shown everywhere the header itself renders.
 */
export function HeaderNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let active = true;
    void probeSession().then((session) => {
      if (active) setUser(session);
    });
    return () => {
      active = false;
    };
  }, []);

  const appPath = user ? firstRunPath(user) : null;

  return (
    <>
      {pathname === '/'
        ? SECTIONS.map((key) => (
            <Link key={key} href={`#${key}`} className={`${styles.navLink} ${styles.navSection}`}>
              {t(`sections.${key}`)}
            </Link>
          ))
        : null}
      <Link href={appPath ?? '/sign-in'} className={styles.navLink}>
        {t('signIn')}
      </Link>
      <Link href={appPath ?? '/register'} className={styles.navCta}>
        {t('tryNow')}
      </Link>
    </>
  );
}
