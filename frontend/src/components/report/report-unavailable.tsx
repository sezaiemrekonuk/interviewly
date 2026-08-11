'use client';

import { useTranslations } from 'next-intl';

import { Link } from '../../i18n/navigation';
import { DEFAULT_LANDING_PATH } from '../../lib/auth-redirect';

import { EndedReasonLine } from './ended-reason';

import styles from './report.module.css';

/**
 * The terminal states the report screen used to render as a wait (issue 83): `failed` is a
 * dead-lettered job, `abandoned` an interview that never reached evaluation. Neither will
 * ever produce a report, so the generating beat is a lie and its 60s timeout tells the user
 * to refresh forever.
 *
 * `endedReason` is rendered because "we couldn't generate your report" answers the wrong
 * question. The interview stopped for a reason the server already knows — the clock ran out,
 * the interviewer ended it, the budget did — and a candidate looking at half an interview and
 * no report was left to guess which. The reason is stated whether or not a report exists;
 * `ReportView` says the same thing above a report that did land.
 */
export function ReportUnavailable({
  state,
  endedReason,
}: {
  state: 'failed' | 'abandoned';
  endedReason: string | null;
}) {
  const t = useTranslations('report');
  const key = state === 'abandoned' ? 'abandoned' : 'failed';

  return (
    <div role="alert" className={styles.unavailable} data-testid="report-unavailable">
      <p className={styles.unavailableTitle}>{t(`${key}Title`)}</p>
      <p className={styles.unavailableBody}>{t(`${key}Body`)}</p>
      <EndedReasonLine endedReason={endedReason} className={styles.unavailableBody} />
      <Link href={DEFAULT_LANDING_PATH} className={styles.unavailableLink}>
        {t('backToInterviews')}
      </Link>
    </div>
  );
}
