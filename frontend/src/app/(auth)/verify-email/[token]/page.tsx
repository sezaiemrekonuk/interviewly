'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import styles from '../../../../components/auth/auth.module.css';
import { apiPost } from '../../../../lib/api';
import { firstRunPath } from '../../../../lib/first-run';
import { useErrorMessage } from '../../../../lib/use-error-message';
import type { SessionUser } from '../../../../lib/use-require-auth';

type Outcome =
  | { state: 'pending' }
  | { state: 'ok'; user: SessionUser }
  | { state: 'failed'; code: string };

/**
 * Confirm-on-mount. The route is public on purpose: the link is opened wherever the mail
 * was read, which is routinely a different browser from the one that registered, and a
 * session requirement here would strand exactly the people it is for.
 */
export default function ConfirmVerificationPage() {
  const t = useTranslations('auth');
  const messageFor = useErrorMessage();
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';

  const [outcome, setOutcome] = useState<Outcome>({ state: 'pending' });

  // The token is single-use, so a second POST always answers EMAIL_TOKEN_INVALID. Under
  // React's development double-mount that would turn every successful confirmation into a
  // failure screen, so the guard is about correctness of what the visitor sees, not tidiness.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || !token) return;
    fired.current = true;

    let active = true;
    apiPost<{ user: SessionUser }>('/auth/verify-email/confirm', { token }).then((result) => {
      if (!active) return;
      setOutcome(
        result.ok && result.data
          ? { state: 'ok', user: result.data.user }
          : { state: 'failed', code: result.code ?? 'UNKNOWN' },
      );
    });

    return () => {
      active = false;
    };
  }, [token]);

  if (outcome.state === 'pending') {
    return (
      <section className={styles.card}>
        <h1 className={styles.title}>{t('verifyConfirming')}</h1>
      </section>
    );
  }

  if (outcome.state === 'ok') {
    return (
      <section className={styles.card}>
        <h1 className={styles.title}>{t('verifyConfirmedTitle')}</h1>
        <p className={styles.subtitle}>{t('verifyConfirmedBody')}</p>
        <p className={styles.footer}>
          <Link className={styles.footerLink} href={firstRunPath(outcome.user)}>
            {t('goToDashboard')}
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <h1 className={styles.title}>{t('verifyFailedTitle')}</h1>
      {/* Expired and invalid are two codes for a reason: only one of them means a fresh
          link will help, and the registry copy is what says so. */}
      <p className={styles.banner} role="alert">
        {messageFor(outcome.code)}
      </p>
      <p className={styles.footer}>
        <Link className={styles.footerLink} href="/verify-email">
          {t('resend')}
        </Link>
      </p>
      <p className={styles.footer}>
        <Link className={styles.footerLink} href="/sign-in">
          {t('backToSignIn')}
        </Link>
      </p>
    </section>
  );
}
