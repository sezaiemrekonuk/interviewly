'use client';

import { useTranslations } from 'next-intl';

import { API_BASE } from '../../lib/api';
import { useAuthCapabilities } from '../../lib/query';

import styles from './auth.module.css';

/**
 * A plain anchor, deliberately — not `next/link`, not `fetch`.
 *
 * `GET /auth/google` answers 302 to accounts.google.com and sets the short-lived
 * `oauth_state` cookie on the way out. Only a real browser navigation follows that chain
 * and keeps the cookie; a client-side fetch would drop both.
 *
 * That same navigation is why the button has to know whether Google is configured before it
 * offers itself: a refusal on this href replaces the whole document rather than surfacing
 * through `useErrorMessage` (issue 60). `GET /auth/capabilities` is the answer, asked at
 * runtime because a `NEXT_PUBLIC_*` flag would be inlined during a Docker build that has no
 * env file and would hide the button everywhere.
 */
export function GoogleButton() {
  const t = useTranslations('auth');
  const { data } = useAuthCapabilities();

  // Fails closed on purpose, and covers the pending fetch as well as a refused one: an
  // unanswered "can this deployment do Google?" is not a yes, and a dead control is worse
  // than a missing one here.
  if (!data?.oauth.google) return null;

  return (
    <>
      <div className={styles.divider}>{t('orDivider')}</div>
      <a className={styles.google} href={`${API_BASE}/auth/google`}>
        {t('googleButton')}
      </a>
    </>
  );
}
