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

/** Refusals only `GET /auth/google` can raise — never the password path. */
const OAUTH_ONLY_ERRORS = new Set(['ADMIN_MUST_USE_PASSWORD', 'ACCOUNT_LINK_REQUIRES_PASSWORD']);

function SignIn() {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();

  // A02 sends the two K8 refusals here as `/sign-in?error=<CODE>` mid-redirect, so the
  // message has to come up without the visitor touching anything.
  const errorCode = searchParams.get('error');
  // …but which control it belongs to depends on the code. These two are reachable only
  // through the Google flow (`modules/auth/google.ts`), and both recover by using the
  // password form — so putting them above that form marks the control that would have
  // worked and leaves the one that failed unannotated (issue 139).
  const oauthError = errorCode !== null && OAUTH_ONLY_ERRORS.has(errorCode);
  const explicitReturnPath = searchParams.get('returnPath');
  const returnPath = safeReturnPath(explicitReturnPath);

  return (
    <AuthShell rail="SignIn" title={t('signInTitle')} subtitle={t('signInSubtitle')}>
      <CredentialsForm
        endpoint="/auth/login"
        schema={loginSchema}
        submitLabel={t('signIn')}
        initialErrorCode={oauthError ? null : errorCode}
        onSuccess={(user) =>
          router.replace(explicitReturnPath ? returnPath : firstRunPath(user))
        }
      />

      <GoogleButton errorCode={oauthError ? errorCode : null} />

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
