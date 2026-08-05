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
      <p role="alert" className={styles.waitTimedOut} data-testid="report-wait-timeout">
        {t('waitTimedOut')}
      </p>
    );
  }

  return (
    <div className={styles.wait} role="status" data-testid="report-wait">
      <p>{t('waitGenerating')}</p>
    </div>
  );
}
