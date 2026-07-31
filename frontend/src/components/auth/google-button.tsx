import { useTranslations } from 'next-intl';

import { API_BASE } from '../../lib/api';

import styles from './auth.module.css';

/**
 * A plain anchor, deliberately — not `next/link`, not `fetch`.
 *
 * `GET /auth/google` answers 302 to accounts.google.com and sets the short-lived
 * `oauth_state` cookie on the way out. Only a real browser navigation follows that chain
 * and keeps the cookie; a client-side fetch would drop both.
 */
export function GoogleButton() {
  const t = useTranslations('auth');

  return (
    <>
      <div className={styles.divider}>{t('orDivider')}</div>
      <a className={styles.google} href={`${API_BASE}/auth/google`}>
        {t('googleButton')}
      </a>
    </>
  );
}
