'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { AuthShell } from '../../../../components/auth/auth-shell';
import styles from '../../../../components/auth/auth.module.css';
import { Button, Field, Input } from '../../../../components/ui';
import { Link } from '../../../../i18n/navigation';
import { apiPost } from '../../../../lib/api';
import { useErrorMessage } from '../../../../lib/use-error-message';

const schema = z.object({ email: z.string().email({ message: 'VALIDATION_ERROR' }) });

type Values = z.infer<typeof schema>;

/**
 * K8.6 — the screen must not know more than the API tells it, and the API tells it nothing:
 * `POST /auth/password-reset/request` answers 202 for a registered, a Google-only and an
 * unknown address alike. So there is one success state and one copy, and no branch here
 * could reintroduce the enumeration the endpoint spent its design closing.
 */
export default function ForgotPasswordPage() {
  const t = useTranslations('auth');
  const messageFor = useErrorMessage();

  const [sent, setSent] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: 'onSubmit' });

  async function onSubmit(values: Values) {
    setErrorCode(null);
    const result = await apiPost('/auth/password-reset/request', values);
    if (result.ok) {
      setSent(true);
      return;
    }
    // The only refusals are RATE_LIMITED and VALIDATION_ERROR; neither depends on whether
    // the address has an account.
    setErrorCode(result.code ?? 'UNKNOWN');
  }

  if (sent) {
    return (
      <AuthShell rail="Forgot" title={t('forgotSentTitle')} subtitle={t('forgotSentBody')}>
        <p className={styles.footer}>
          <Link className={styles.footerLink} href="/sign-in">
            {t('backToSignIn')}
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell rail="Forgot" title={t('forgotTitle')} subtitle={t('forgotSubtitle')}>
      {errorCode && (
        <p className={styles.banner} role="alert">
          {messageFor(errorCode)}
        </p>
      )}

      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <Field
          label={t('emailLabel')}
          id="email"
          error={errors.email?.message && messageFor(errors.email.message)}
        >
          {(control) => <Input {...control} type="email" autoComplete="email" {...register('email')} />}
        </Field>

        <Button className={styles.submit} type="submit" size="lg" loading={isSubmitting}>
          {t('sendResetLink')}
        </Button>
      </form>

      <p className={styles.footer}>
        <Link className={styles.footerLink} href="/sign-in">
          {t('backToSignIn')}
        </Link>
      </p>
    </AuthShell>
  );
}
