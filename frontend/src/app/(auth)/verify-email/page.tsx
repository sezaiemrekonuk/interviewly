'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import styles from '../../../components/auth/auth.module.css';
import { Button } from '../../../components/ui';
import { apiPost } from '../../../lib/api';
import { useErrorMessage } from '../../../lib/use-error-message';
import { useRequireAuth } from '../../../lib/use-require-auth';

interface ResendResponse {
  cooldownSeconds: number;
}

/**
 * The pending screen (K8.6). It is reachable and useful at any time — verification never
 * traps anyone here, which is why the "continue without verifying" link is not conditional.
 *
 * The client cannot read `EMAIL_VERIFICATION_REQUIRED`; it is server configuration and
 * exposing it would put a second copy of the rule in a place that can disagree with the
 * gate. With the flag off, continuing works. With it on, `POST /interviews` answers
 * `EMAIL_NOT_VERIFIED` and the setup screen routes back here — one refusal, one place.
 */
export default function VerifyEmailPage() {
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const messageFor = useErrorMessage();
  const { user, loading } = useRequireAuth();

  const [remaining, setRemaining] = useState(0);
  const [sent, setSent] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // One interval for the whole countdown, torn down when it reaches zero. Re-arming a
  // timeout per second would drift by however long each render took.
  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => setRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [remaining]);

  async function resend() {
    setBusy(true);
    setErrorCode(null);
    const result = await apiPost<ResendResponse>('/auth/verify-email/request', {});
    setBusy(false);

    // The countdown comes from the server on both answers: 202 says how long until the
    // next one is allowed, and the cooldown refusal says how much of that is left. A
    // client-side timer would drift out of agreement with the only clock that decides.
    if (result.ok) {
      setSent(true);
      setRemaining(result.data?.cooldownSeconds ?? 60);
      return;
    }

    setSent(false);
    setErrorCode(result.code);
    setRemaining((result.payload as Partial<ResendResponse> | null)?.cooldownSeconds ?? 0);
  }

  if (loading) return <p className={styles.subtitle}>{tCommon('loading')}</p>;

  // Nothing to confirm: an account that arrived through Google is already verified.
  if (user?.emailVerifiedAt) {
    return (
      <section className={styles.card}>
        <h1 className={styles.title}>{t('verifyConfirmedTitle')}</h1>
        <p className={styles.subtitle}>{t('verifyConfirmedBody')}</p>
        <p className={styles.footer}>
          <Link className={styles.footerLink} href="/">
            {t('goToDashboard')}
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <h1 className={styles.title}>{t('verifyPendingTitle')}</h1>
      <p className={styles.subtitle}>{t('verifyPendingSubtitle')}</p>
      <p className={styles.subtitle}>{t('verifyPendingWhatNext')}</p>

      {errorCode && (
        <p className={styles.banner} role="alert">
          {messageFor(errorCode)}
        </p>
      )}
      {sent && <p className={styles.subtitle}>{t('resendSent')}</p>}

      <Button
        className={styles.submit}
        size="lg"
        loading={busy}
        disabled={remaining > 0}
        onClick={resend}
      >
        {remaining > 0 ? t('resendIn', { seconds: remaining }) : t('resend')}
      </Button>

      <p className={styles.footer}>
        <Link className={styles.footerLink} href="/">
          {t('continueWithoutVerifying')}
        </Link>
      </p>
    </section>
  );
}
