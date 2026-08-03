'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import styles from '../../../components/auth/auth.module.css';
import { apiPost } from '../../../lib/api';
import { useErrorMessage } from '../../../lib/use-error-message';

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
      <section className={styles.card}>
        <h1 className={styles.title}>{t('forgotSentTitle')}</h1>
        <p className={styles.subtitle}>{t('forgotSentBody')}</p>
        <p className={styles.footer}>
          <Link className={styles.footerLink} href="/sign-in">
            {t('backToSignIn')}
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <h1 className={styles.title}>{t('forgotTitle')}</h1>
      <p className={styles.subtitle}>{t('forgotSubtitle')}</p>

      {errorCode && (
        <p className={styles.banner} role="alert">
          {messageFor(errorCode)}
        </p>
      )}

      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            {t('emailLabel')}
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className={styles.input}
            aria-invalid={errors.email ? 'true' : undefined}
            {...register('email')}
          />
          {errors.email?.message && (
            <p className={styles.fieldError}>{messageFor(errors.email.message)}</p>
          )}
        </div>

        <button className={styles.submit} type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('submitting') : t('sendResetLink')}
        </button>
      </form>

      <p className={styles.footer}>
        <Link className={styles.footerLink} href="/sign-in">
          {t('backToSignIn')}
        </Link>
      </p>
    </section>
  );
}
