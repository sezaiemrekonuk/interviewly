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
 *
 * `disabled` is a second, orthogonal gate: `/register`'s consent box (issue 009). The Google
 * redirect creates an account too, so it cannot sit outside the box. Unlike the capability
 * gate it keeps the control rendered — the visitor has to see what ticking the box unlocks.
 * It stays an anchor and takes no click handler: `aria-disabled` plus `pointer-events: none`
 * and `tabIndex={-1}` is the whole mechanism.
 */
export function GoogleButton({ disabled = false }: { disabled?: boolean }) {
  const t = useTranslations('auth');
  const { data } = useAuthCapabilities();

  // Fails closed on purpose, and covers the pending fetch as well as a refused one: an
  // unanswered "can this deployment do Google?" is not a yes, and a dead control is worse
  // than a missing one here.
  if (!data?.oauth.google) return null;

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
