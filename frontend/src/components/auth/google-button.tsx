import { useTranslations } from 'next-intl';

import { API_BASE } from '../../lib/api';

import styles from './auth.module.css';

/**
 * A plain anchor, deliberately — not `next/link`, not `fetch`.
 *
 * `GET /auth/google` answers 302 to accounts.google.com and sets the short-lived
 * `oauth_state` cookie on the way out. Only a real browser navigation follows that chain
 * and keeps the cookie; a client-side fetch would drop both.
 *
 * `disabled` is `/register`'s consent gate (issue 009) — the Google redirect creates an
 * account too, so it cannot sit outside the box. It stays an anchor and takes no click
 * handler: `aria-disabled` plus `pointer-events: none` and `tabIndex={-1}` is the whole
 * mechanism, so this component still works anywhere a server tree renders it.
 */
export function GoogleButton({ disabled = false }: { disabled?: boolean }) {
  const t = useTranslations('auth');

  return (
    <>
      <div className={styles.divider}>{t('orDivider')}</div>
      <a
        className={disabled ? `${styles.google} ${styles.googleDisabled}` : styles.google}
        href={`${API_BASE}/auth/google`}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
      >
        {t('googleButton')}
      </a>
    </>
  );
}
