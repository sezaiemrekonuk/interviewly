'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense } from 'react';

import { AuthShell } from '../../../components/auth/auth-shell';
import styles from '../../../components/auth/auth.module.css';
import { CredentialsForm, loginSchema } from '../../../components/auth/credentials-form';
import { GoogleButton } from '../../../components/auth/google-button';
import { safeReturnPath } from '../../../lib/auth-redirect';
import { firstRunPath } from '../../../lib/first-run';

function SignIn() {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();

  // A02 sends the two K8 refusals here as `/sign-in?error=<CODE>` mid-redirect, so the
  // banner has to come up without the visitor touching the form.
  const errorCode = searchParams.get('error');
  const explicitReturnPath = searchParams.get('returnPath');
  const returnPath = safeReturnPath(explicitReturnPath);

  return (
    <AuthShell rail="SignIn" title={t('signInTitle')} subtitle={t('signInSubtitle')}>
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

      {/* Both ways out of this screen on one line: neither is the subject, and stacking
          them gave two quiet links the weight of two sections. */}
      <p className={styles.footer}>
        <Link className={styles.footerLink} href="/forgot-password">
          {t('forgotPassword')}
        </Link>
        <span className={styles.footerSep} aria-hidden="true">
          ·
        </span>
        <span>{t('noAccount')}</span>
        <Link className={styles.footerLink} href="/register">
          {t('register')}
        </Link>
      </p>
    </AuthShell>
  );
}

export default function SignInPage() {
  // `useSearchParams` opts a client component into request-time rendering; without a
  // boundary `next build` refuses to prerender the route at all.
  return (
    <Suspense fallback={null}>
      <SignIn />
    </Suspense>
  );
}
