'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiGet } from '../../lib/api';

import styles from './chrome.module.css';

/**
 * The authenticated half of the header. Deliberately *not* `useMe()`: the header renders
 * on the landing page, and pulling React Query into that tree spends the §8.1 JS budget on
 * one boolean. A refused `/me` is not an error here — the link simply is not shown.
 *
 * No sign-out control: `frontend/src/lib` ships no sign-out helper and no `POST /auth/logout`
 * exists yet. Building the auth call here would put session logic in the chrome.
 */
export function HeaderNav() {
  const t = useTranslations('chrome');
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

  // History lives on `/` (W08), which the wordmark already goes to; the nav keeps the one
  // thing the wordmark cannot say.
  return (
    <Link href="/interviews/new" className={styles.navLink}>
      {t('newInterview')}
    </Link>
  );
}
