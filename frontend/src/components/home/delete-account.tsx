'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useDeleteAccount } from '../../lib/query';
import { useErrorMessage } from '../../lib/use-error-message';

import styles from './home.module.css';

/**
 * KVKK Art. 7 / GDPR Art. 17, from the UI (issue 009). Quiet on purpose: it is a right, not
 * a feature, so it sits below the history in `--text-muted` and never competes with the
 * surface's one `--primary`. Two clicks, like the per-interview delete beside it — one click
 * never destroys an account.
 *
 * On success the browser is sent through a full navigation rather than a client-side one:
 * `HomeSwitch` probes `/me` exactly once on mount, so only a real reload can flip `/` back
 * to the anonymous landing.
 */
export function DeleteAccount() {
  const t = useTranslations('home');
  const errorMessage = useErrorMessage();
  const erase = useDeleteAccount();
  const [confirming, setConfirming] = useState(false);

  return (
    <section className={styles.dangerZone} data-testid="delete-account">
      <h2 className={styles.dangerTitle}>{t('deleteAccountTitle')}</h2>
      <p className={styles.dangerBody}>{t('deleteAccountBody')}</p>

      {erase.error ? (
        <p role="alert" className={styles.rowError}>
          {errorMessage(erase.error.code)}
        </p>
      ) : null}

      {confirming ? (
        <div className={styles.confirm}>
          <span className={styles.confirmQuestion}>{t('deleteAccountConfirm')}</span>
          <button
            type="button"
            className={styles.confirmAction}
            disabled={erase.isPending}
            onClick={() =>
              erase.mutate(undefined, { onSuccess: () => window.location.assign('/') })
            }
          >
            {t('deleteAccountConfirmAction')}
          </button>
          <button type="button" className={styles.textAction} onClick={() => setConfirming(false)}>
            {t('cancel')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={styles.dangerAction}
          onClick={() => setConfirming(true)}
        >
          {t('deleteAccountAction')}
        </button>
      )}
    </section>
  );
}
