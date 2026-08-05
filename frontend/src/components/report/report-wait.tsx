'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import styles from './report.module.css';

/** §8.1 — the report is promised in < 60 s; past that the wait stops being a wait. */
const BUDGET_MS = 60_000;

/**
 * The "generating your report" beat, distinct from the loading skeleton. It owns the ceiling
 * and nothing else — the SSE nudge is the page's, the poll fallback is `useReport`'s. The
 * timer lives here because this component only exists while the wait does; `onTimeout` is
 * what switches the fallback poll off.
 */
export function ReportWait({ onTimeout }: { onTimeout: () => void }) {
  const t = useTranslations('report');
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setTimedOut(true);
      onTimeout();
    }, BUDGET_MS);
    return () => clearTimeout(timer);
  }, [onTimeout]);

  if (timedOut) {
    return (
      <div role="alert" className={styles.waitTimedOut} data-testid="report-wait-timeout">
        <p className={styles.waitTimedOutText}>{t('waitTimedOut')}</p>
      </div>
    );
  }

  // The panel holds the report's height with two static bars, so resolving does not jump the
  // layout, and the copy says how long this should take instead of just spinning.
  return (
    <div className={styles.wait} role="status" data-testid="report-wait">
      <p className={styles.waitTitle}>{t('waitGenerating')}</p>
      <p className={styles.waitHint}>{t('waitHint')}</p>
      <div className={styles.waitLines} aria-hidden="true">
        <span className={styles.waitLine} />
        <span className={`${styles.waitLine} ${styles.waitLineShort}`} />
      </div>
    </div>
  );
}
