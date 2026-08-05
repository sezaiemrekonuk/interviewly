'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import styles from '../../../../components/auth/auth.module.css';
import { Button, Field, Input } from '../../../../components/ui';
import { apiPost } from '../../../../lib/api';
import { useErrorMessage } from '../../../../lib/use-error-message';

/**
 * The confirm rule the server enforces is a length, and only a length. A complexity meter
 * here would invent a requirement the API does not have and refuse passwords it accepts.
 */
const MISMATCH = 'PASSWORDS_MISMATCH';

const schema = z
  .object({
    password: z.string().min(10, { message: 'PASSWORD_TOO_SHORT' }),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: MISMATCH,
  });

type Values = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const t = useTranslations('auth');
  const messageFor = useErrorMessage();
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';

  const [done, setDone] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: 'onSubmit' });

  // `MISMATCH` is the one rule with no server counterpart, so it is the one message that
  // does not come from the error registry — there is no API code it could ever mirror.
  const fieldMessage = (code: string) => (code === MISMATCH ? t('passwordsMismatch') : messageFor(code));

  async function onSubmit(values: Values) {
    setErrorCode(null);
    const result = await apiPost('/auth/password-reset/confirm', {
      token,
      password: values.password,
    });
    if (result.ok) {
      setDone(true);
      return;
    }
    setErrorCode(result.code ?? 'UNKNOWN');
  }

  if (done) {
    return (
      <section className={styles.card}>
        <h1 className={styles.title}>{t('resetDoneTitle')}</h1>
        {/* Every session died with the password write, this browser's included — saying so
            is the difference between "signed out" reading as a bug and as the point. */}
        <p className={styles.subtitle}>{t('resetDoneBody')}</p>
        <p className={styles.footer}>
          <Link className={styles.footerLink} href="/sign-in">
            {t('signIn')}
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <h1 className={styles.title}>{t('resetTitle')}</h1>
      <p className={styles.subtitle}>{t('resetSubtitle')}</p>

      {errorCode && (
        <p className={styles.banner} role="alert">
          {messageFor(errorCode)}
        </p>
      )}

      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <Field
          label={t('newPasswordLabel')}
          id="password"
          hint={t('passwordHint')}
          error={errors.password?.message && fieldMessage(errors.password.message)}
        >
          {(control) => (
            <Input {...control} type="password" autoComplete="new-password" {...register('password')} />
          )}
        </Field>

        <Field
          label={t('confirmPasswordLabel')}
          id="confirmPassword"
          error={errors.confirmPassword?.message && fieldMessage(errors.confirmPassword.message)}
        >
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="new-password"
              {...register('confirmPassword')}
            />
          )}
        </Field>

        <Button className={styles.submit} type="submit" size="lg" loading={isSubmitting}>
          {t('resetSubmit')}
        </Button>
      </form>

      <p className={styles.footer}>
        <Link className={styles.footerLink} href="/forgot-password">
          {t('sendResetLink')}
        </Link>
      </p>
    </section>
  );
}
