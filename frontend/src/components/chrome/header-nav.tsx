'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { DEFAULT_LANDING_PATH } from '../../lib/auth-redirect';
import { probeSession } from '../../lib/session-probe';

import styles from './chrome.module.css';

/** In document order, so the header reads the same sequence a visitor scrolls through. */
const SECTIONS = ['demo', 'mechanism', 'modes', 'report', 'faq'] as const;

/**
 * The authenticated half of the site header, which now renders on exactly three routes: the
 * marketing landing and the two legal pages. Everywhere else the rail carries navigation
 * (`components/shell/app-rail.tsx`), including sign-out — the control this file used to
 * explain the absence of.
 *
 * Deliberately *not* `useMe()`: this renders on the anonymous landing, and pulling React Query
 * into that tree spends the §8.1 JS budget on one boolean. A refused `/me` is not an error
 * here — the link simply is not shown. The probe is shared with `home/home-switch.tsx`, which
 * needs the same answer in the same tree (`lib/session-probe.ts`, issue 130).
 *
 * One link, not three, when signed in. A signed-in visitor reading the privacy notice needs
 * the way back into the product; everything else they might want is on the rail once they
 * are there. Signed out, the header instead offers the two doors in: sign in, and a bordered
 * "try now" — bordered rather than `--primary` because the landing hero already spends the
 * page's one CTA colour above the fold (DESIGN §2 rule 1).
 *
 * The section anchors are landing-only (plain `#id` links, no JS scroll library — the
 * platform's own anchor scrolling plus `scroll-behavior: smooth` in `globals.css` does this),
 * so they are gated on the route rather than shown everywhere the header itself renders.
 */
export function HeaderNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  // Three states, not two (issue 95). `false` as the initial value is a guess, and it is the
  // wrong one for a signed-in visitor: the header painted "Sign in" and "Try now" on every
  // load until `/me` answered, then swapped them. `null` is "not known yet", and the actions
  // wait for it — a header that flashes the wrong doorway is worse than one that arrives late.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void probeSession().then((user) => {
      if (active) setSignedIn(Boolean(user));
    });
    return () => {
      active = false;
    };
  }, []);

  const sectionLinks =
    pathname === '/' ? (
      <>
        {SECTIONS.map((key) => (
          <Link key={key} href={`#${key}`} className={styles.navLink}>
            {t(`sections.${key}`)}
          </Link>
        ))}
      </>
    ) : null;

  // The section anchors are the same for everyone and depend on the route, not the session, so
  // they render immediately; only the two auth actions wait.
  if (signedIn === null) return sectionLinks;

  if (!signedIn) {
    return (
      <>
        {sectionLinks}
        <Link href="/sign-in" className={styles.navLink}>
          {t('signIn')}
        </Link>
        <Link href="/register" className={styles.navCta}>
          {t('tryNow')}
        </Link>
      </>
    );
  }

  return (
    <>
      {sectionLinks}
      <Link href={DEFAULT_LANDING_PATH} className={styles.navLink}>
        {t('today')}
      </Link>
    </>
  );
}
