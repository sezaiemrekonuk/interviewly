'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { DEFAULT_LANDING_PATH } from '../../lib/auth-redirect';

import styles from './report.module.css';

/**
 * The terminal states the report screen used to render as a wait (issue 83): `failed` is a
 * dead-lettered job, `abandoned` an interview that never reached evaluation. Neither will
 * ever produce a report, so the generating beat is a lie and its 60s timeout tells the user
 * to refresh forever.
 */
export function ReportUnavailable({ state }: { state: 'failed' | 'abandoned' }) {
  const t = useTranslations('report');
  const key = state === 'abandoned' ? 'abandoned' : 'failed';

  return (
    <div role="alert" className={styles.unavailable} data-testid="report-unavailable">
      <p className={styles.unavailableTitle}>{t(`${key}Title`)}</p>
      <p className={styles.unavailableBody}>{t(`${key}Body`)}</p>
      <Link href={DEFAULT_LANDING_PATH} className={styles.unavailableLink}>
        {t('backToInterviews')}
      </Link>
    </div>
  );
}
