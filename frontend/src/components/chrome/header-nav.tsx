'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiGet } from '../../lib/api';
import { DEFAULT_LANDING_PATH } from '../../lib/auth-redirect';

import styles from './chrome.module.css';

/**
 * The authenticated half of the site header, which now renders on exactly three routes: the
 * marketing landing and the two legal pages. Everywhere else the rail carries navigation
 * (`components/shell/app-rail.tsx`), including sign-out — the control this file used to
 * explain the absence of.
 *
 * Deliberately *not* `useMe()`: this renders on the anonymous landing, and pulling React Query
 * into that tree spends the §8.1 JS budget on one boolean. A refused `/me` is not an error
 * here — the link simply is not shown.
 *
 * One link, not three. A signed-in visitor reading the privacy notice needs the way back into
 * the product; everything else they might want is on the rail once they are there.
 */
export function HeaderNav() {
  const t = useTranslations('nav');
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;
    void apiGet<{ user: unknown }>('/me').then((result) => {
      if (active) setSignedIn(result.ok);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!signedIn) return null;

  return (
    <Link href={DEFAULT_LANDING_PATH} className={styles.navLink}>
      {t('today')}
    </Link>
  );
}
