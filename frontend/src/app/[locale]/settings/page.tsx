'use client';

/**
 * `/settings` — the account surface, which the product did not have.
 *
 * Its absence is why erasure ended up bolted to the foot of `/profile`, under a CV upload, on
 * every one of that screen's four tabs; and why the email *address* sat on a form tab while
 * its verification state sat in the dark nav rail forty pixels away on a different material.
 * Both halves of that fact are here now, on one row, where the address is.
 *
 * The split follows what Linear, Vercel, Notion, GitHub and Stripe all do: identity and the
 * things the product reads about you live on the profile; the account, its credentials, its
 * preferences and its ending live here. Delete account is at the bottom of this page and
 * nowhere else in the product.
 */

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { AppRail } from '../../../components/shell/app-rail';
import { SplitShell, WorkBody, WorkTop } from '../../../components/shell/split-shell';
import { Button } from '../../../components/ui';
import { Link } from '../../../i18n/navigation';
import { apiPost } from '../../../lib/api';
import { useDeleteAccount } from '../../../lib/query';
import { useErrorMessage } from '../../../lib/use-error-message';
import { useRequireAuth } from '../../../lib/use-require-auth';

import { LocaleSwitcher } from '../../../components/locale-switcher';

import styles from './settings.module.css';

export default function SettingsPage() {
  const t = useTranslations('settings');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const { user, loading } = useRequireAuth();

  const [resetState, setResetState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [confirmEmail, setConfirmEmail] = useState('');
  const erase = useDeleteAccount();

  if (loading || !user) return null;

  const verified = Boolean(user.emailVerifiedAt);
  // Case-insensitively, and trimmed: this is a confirmation that the right person is typing,
  // not a password. Rejecting "  Ada@Example.com " would only teach people to paste harder.
  const mayErase = confirmEmail.trim().toLocaleLowerCase(locale) === user.email.toLocaleLowerCase(locale);

  async function sendReset() {
    setResetState('sending');
    // 202 either way — the endpoint does not disclose whether an address is registered, and
    // this screen must not become the oracle that the sign-in flow refuses to be.
    await apiPost('/auth/password-reset/request', { email: user?.email });
    setResetState('sent');
  }

  return (
    <SplitShell rail={<AppRail user={user} />} className={styles.shell}>
      <WorkTop title={t('title')} />

      <WorkBody className={styles.body}>
        {/* ------------------------------------------------------------------- account */}
        <section className={styles.section} aria-labelledby="account-heading">
          <h2 id="account-heading" className={styles.sectionTitle}>
            {t('account.title')}
          </h2>

          <div className={styles.row}>
            <div className={styles.rowMain}>
              <p className={styles.rowLabel}>{t('account.emailLabel')}</p>
              <p className={styles.rowValue}>{user.email}</p>
              {/* The state, on the same row as the address it describes. */}
              <p className={verified ? styles.verified : styles.unverified}>
                {verified ? t('account.verified') : t('account.unverified')}
              </p>
            </div>
            {verified ? null : (
              <Link href="/verify-email" className={styles.rowAction}>
                {t('account.verify')}
              </Link>
            )}
          </div>

          <div className={styles.row}>
            <div className={styles.rowMain}>
              <p className={styles.rowLabel}>{t('account.passwordLabel')}</p>
              {/* No change-password endpoint exists; the reset flow is the one that does. Said
                  plainly rather than shown as a form that would have nowhere to post to. */}
              <p className={styles.rowNote}>{t('account.passwordBody')}</p>
              {resetState === 'sent' ? (
                <p className={styles.rowOutcome} role="status">
                  {t('account.passwordSent')}
                </p>
              ) : null}
            </div>
            <Button
              variant="secondary"
              loading={resetState === 'sending'}
              disabled={resetState === 'sent'}
              onClick={() => void sendReset()}
            >
              {t('account.passwordAction')}
            </Button>
          </div>
        </section>

        {/* ---------------------------------------------------------------- preferences */}
        <section className={styles.section} aria-labelledby="prefs-heading">
          <h2 id="prefs-heading" className={styles.sectionTitle}>
            {t('preferences.title')}
          </h2>

          <div className={styles.row}>
            <div className={styles.rowMain}>
              <p className={styles.rowLabel}>{t('preferences.languageLabel')}</p>
              <p className={styles.rowNote}>{t('preferences.languageBody')}</p>
            </div>
            {/* Reachable from fifteen more routes than it used to be: the switcher lived in a
                header that only two pages rendered. */}
            <LocaleSwitcher />
          </div>
        </section>

        {/* --------------------------------------------------------------------- privacy */}
        <section className={styles.section} aria-labelledby="privacy-heading">
          <h2 id="privacy-heading" className={styles.sectionTitle}>
            {t('privacy.title')}
          </h2>
          <p className={styles.sectionBody}>{t('privacy.body')}</p>
          <p className={styles.links}>
            <Link href="/privacy" className={styles.link}>
              {t('privacy.notice')}
            </Link>
            <Link href="/terms" className={styles.link}>
              {t('privacy.terms')}
            </Link>
          </p>
        </section>

        {/* ------------------------------------------------------------------- erasure */}
        {/* KVKK Art. 7 / GDPR Art. 17. One place in the product, at the bottom of the page
            that owns the account, behind typing the address — the weight Notion uses for the
            same action. Quiet, because it is a right rather than a feature, and it must never
            compete for attention with anything above it. */}
        <section className={styles.danger} aria-labelledby="danger-heading" data-testid="delete-account">
          <h2 id="danger-heading" className={styles.dangerTitle}>
            {t('erase.title')}
          </h2>
          <p className={styles.dangerBody}>{t('erase.body')}</p>

          {erase.error ? (
            <p role="alert" className={styles.dangerError}>
              {errorMessage(erase.error.code)}
            </p>
          ) : null}

          <label className={styles.confirmField} htmlFor="erase-confirm">
            <span className={styles.confirmLabel}>{t('erase.confirmLabel')}</span>
            <input
              id="erase-confirm"
              className={styles.confirmInput}
              type="email"
              autoComplete="off"
              spellCheck={false}
              value={confirmEmail}
              onChange={(event) => setConfirmEmail(event.target.value)}
            />
          </label>

          <button
            type="button"
            className={styles.dangerAction}
            disabled={!mayErase || erase.isPending}
            onClick={() =>
              erase.mutate(undefined, {
                // A full navigation, not a client one: every cached read on this session is
                // about an account that no longer exists.
                onSuccess: () => window.location.assign('/'),
              })
            }
          >
            {erase.isPending ? t('erase.erasing') : t('erase.action')}
          </button>
        </section>
      </WorkBody>
    </SplitShell>
  );
}
