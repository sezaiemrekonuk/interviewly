'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import styles from '../../app/dashboard/dashboard.module.css';
import { Mascot } from '../mascot';

/** The designed first-run screen — `shrug` is the only mascot this route may show. */
export function EmptyDashboard() {
  const t = useTranslations('dashboard');
  return (
    <div className={styles.empty} data-testid="dashboard-empty">
      <Mascot pose="shrug" />
      <h2 className={styles.emptyTitle}>{t('empty.title')}</h2>
      <p className={styles.emptyBody}>{t('empty.body')}</p>
      <Link className={styles.cta} href="/interviews/new">
        {t('empty.cta')}
      </Link>
    </div>
  );
}
