'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import styles from '../../../components/auth/auth.module.css';
import { CredentialsForm, registerSchema } from '../../../components/auth/credentials-form';
import { GoogleButton } from '../../../components/auth/google-button';
import { DEFAULT_LANDING_PATH } from '../../../lib/auth-redirect';

// Codes the API can answer register with that name a specific input. Everything else
// (`RATE_LIMITED`, `VALIDATION_ERROR`, anything unrecognised) becomes a form banner.
const FIELD_FOR_CODE = {
  EMAIL_TAKEN: 'email',
  PASSWORD_TOO_SHORT: 'password',
} as const;

export default function RegisterPage() {
  const t = useTranslations('auth');
  const router = useRouter();

  return (
    <section className={styles.card}>
      <h1 className={styles.title}>{t('registerTitle')}</h1>
      <p className={styles.subtitle}>{t('registerSubtitle')}</p>

      <CredentialsForm
        endpoint="/auth/register"
        schema={registerSchema}
        submitLabel={t('register')}
        fieldForCode={FIELD_FOR_CODE}
        // `replace`, not `push`: the back button from the landing page should not return
        // to a registration form for an account that now exists.
        onSuccess={() => router.replace(DEFAULT_LANDING_PATH)}
      />

      <GoogleButton />

      <p className={styles.footer}>
        <span>{t('alreadyHaveAccount')}</span>
        <Link className={styles.footerLink} href="/sign-in">
          {t('signIn')}
        </Link>
      </p>
    </section>
  );
}
