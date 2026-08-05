'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { apiPost } from '../../lib/api';
import type { SessionUser } from '../../lib/use-require-auth';
import { useErrorMessage } from '../../lib/use-error-message';
import { Button, Field, Input } from '../ui';

import styles from './auth.module.css';

/**
 * Zod messages are error *codes*, not sentences. The client-side rules mirror rules the
 * API also enforces, so a locally-caught failure should render exactly the string the
 * server's version of the same failure would — one message per code, one lookup path.
 */
const emailField = z.string().email({ message: 'VALIDATION_ERROR' });

export const registerSchema = z.object({
  email: emailField,
  password: z.string().min(10, { message: 'PASSWORD_TOO_SHORT' }),
});

// Login deliberately does not repeat the length rule: an existing account whose password
// predates the rule must still be able to sign in, and a client-side `min(10)` here would
// lock it out of its own form.
export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, { message: 'VALIDATION_ERROR' }),
});

type Credentials = z.infer<typeof registerSchema>;

export interface CredentialsFormProps {
  /** Backend path, without the `/api` edge prefix. */
  endpoint: '/auth/register' | '/auth/login';
  schema: typeof registerSchema | typeof loginSchema;
  submitLabel: string;
  /** Codes that belong under a specific input; anything else becomes a form banner. */
  fieldForCode?: Partial<Record<string, 'email' | 'password'>>;
  /** A code carried in the URL (A02's `/sign-in?error=<CODE>`), shown on mount. */
  initialErrorCode?: string | null;
  onSuccess: (user: SessionUser) => void;
}

export function CredentialsForm({
  endpoint,
  schema,
  submitLabel,
  fieldForCode = {},
  initialErrorCode = null,
  onSuccess,
}: CredentialsFormProps) {
  const t = useTranslations('auth');
  const messageFor = useErrorMessage();

  // `undefined` means "no submission has answered yet", which is what lets the banner
  // show a code carried in the URL without mirroring a prop into state in an effect.
  // Once the visitor submits, whatever the API said replaces it — including `null`.
  const [submitCode, setSubmitCode] = useState<string | null | undefined>(undefined);
  const bannerCode = submitCode === undefined ? initialErrorCode : submitCode;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Credentials>({ resolver: zodResolver(schema), mode: 'onSubmit' });

  async function onSubmit(values: Credentials) {
    setSubmitCode(null);
    const result = await apiPost<{ user: SessionUser }>(endpoint, values);

    if (result.ok && result.data) {
      onSuccess(result.data.user);
      return;
    }

    const code = result.code ?? 'UNKNOWN';
    const field = fieldForCode[code];
    if (field) setError(field, { message: code });
    else setSubmitCode(code);
  }

  return (
    <>
      {bannerCode && (
        <p className={styles.banner} role="alert">
          {messageFor(bannerCode)}
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

        <Field
          label={t('passwordLabel')}
          id="password"
          error={errors.password?.message && messageFor(errors.password.message)}
        >
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete={endpoint === '/auth/register' ? 'new-password' : 'current-password'}
              {...register('password')}
            />
          )}
        </Field>

        <Button className={styles.submit} type="submit" size="lg" loading={isSubmitting}>
          {submitLabel}
        </Button>
      </form>
    </>
  );
}
