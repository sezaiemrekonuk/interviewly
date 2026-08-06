'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import styles from '../../../components/auth/auth.module.css';
import { CredentialsForm, registerSchema } from '../../../components/auth/credentials-form';
import { GoogleButton } from '../../../components/auth/google-button';
import { firstRunPath } from '../../../lib/first-run';

// Codes the API can answer register with that name a specific input. Everything else
// (`RATE_LIMITED`, `VALIDATION_ERROR`, anything unrecognised) becomes a form banner.
const FIELD_FOR_CODE = {
  EMAIL_TAKEN: 'email',
  PASSWORD_TOO_SHORT: 'password',
} as const;

export default function RegisterPage() {
  const t = useTranslations('auth');
  const router = useRouter();

  // Consent lives on the page, not inside the form: both ways of creating an account —
  // the credentials form and the Google redirect — have to be behind it (issue 009). The
  // server refuses an unconsented registration either way; this is what makes the refusal
  // visible before it happens.
  const [consented, setConsented] = useState(false);

  return (
    <section className={styles.card}>
      <h1 className={styles.title}>{t('registerTitle')}</h1>
      <p className={styles.subtitle}>{t('registerSubtitle')}</p>

      <CredentialsForm
        endpoint="/auth/register"
        schema={registerSchema}
        submitLabel={t('register')}
        fieldForCode={FIELD_FOR_CODE}
        extraBody={{ consent: consented }}
        refuseWith={consented ? null : 'CONSENT_REQUIRED'}
        // `replace`, not `push`: the back button from the landing page should not return
        // to a registration form for an account that now exists.
        onSuccess={(user) => router.replace(firstRunPath(user))}
      >
        <div className={styles.consent}>
          <label className={styles.consentLabel}>
            <input
              type="checkbox"
              className={styles.consentBox}
              checked={consented}
              onChange={(event) => setConsented(event.target.checked)}
            />
            <span>
              {t.rich('consentLabel', {
                privacy: (chunks) => (
                  <Link href="/privacy" className={styles.consentLink}>
                    {chunks}
                  </Link>
                ),
                terms: (chunks) => (
                  <Link href="/terms" className={styles.consentLink}>
                    {chunks}
                  </Link>
                ),
              })}
            </span>
          </label>
          <p className={styles.consentHint}>{t('consentHint')}</p>
        </div>
      </CredentialsForm>

      <GoogleButton disabled={!consented} />

      <p className={styles.footer}>
        <span>{t('alreadyHaveAccount')}</span>
        <Link className={styles.footerLink} href="/sign-in">
          {t('signIn')}
        </Link>
      </p>
    </section>
  );
}
