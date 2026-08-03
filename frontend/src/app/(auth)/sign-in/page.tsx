'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense } from 'react';

import styles from '../../../components/auth/auth.module.css';
import { CredentialsForm, loginSchema } from '../../../components/auth/credentials-form';
import { GoogleButton } from '../../../components/auth/google-button';
import { safeReturnPath } from '../../../lib/auth-redirect';
import { firstRunPath } from '../../../lib/first-run';

function SignInCard() {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();

  // A02 sends the two K8 refusals here as `/sign-in?error=<CODE>` mid-redirect, so the
  // banner has to come up without the visitor touching the form.
  const errorCode = searchParams.get('error');
  const explicitReturnPath = searchParams.get('returnPath');
  const returnPath = safeReturnPath(explicitReturnPath);

  return (
    <section className={styles.card}>
      <h1 className={styles.title}>{t('signInTitle')}</h1>
      <p className={styles.subtitle}>{t('signInSubtitle')}</p>

      <CredentialsForm
        endpoint="/auth/login"
        schema={loginSchema}
        submitLabel={t('signIn')}
        initialErrorCode={errorCode}
        onSuccess={(user) =>
          router.replace(explicitReturnPath ? returnPath : firstRunPath(user))
        }
      />

      <GoogleButton />

      <p className={styles.footer}>
        <Link className={styles.footerLink} href="/forgot-password">
          {t('forgotPassword')}
        </Link>
      </p>

      <p className={styles.footer}>
        <span>{t('noAccount')}</span>
        <Link className={styles.footerLink} href="/register">
          {t('register')}
        </Link>
      </p>
    </section>
  );
}

export default function SignInPage() {
  // `useSearchParams` opts a client component into request-time rendering; without a
  // boundary `next build` refuses to prerender the route at all.
  return (
    <Suspense fallback={null}>
      <SignInCard />
    </Suspense>
  );
}
