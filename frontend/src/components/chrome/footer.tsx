import { useTranslations } from 'next-intl';
import Link from 'next/link';

import styles from './chrome.module.css';

/**
 * One quiet line: who we are, what we do, the year — and the two links that make the legal
 * pages count. A policy nothing links to is a policy nobody can find (issue 009), so these
 * ride the chrome and therefore appear on every surface the chrome wraps.
 */
export function SiteFooter() {
  const t = useTranslations('chrome');

  return (
    <footer className={styles.footer}>
      <p className={styles.line}>
        <span className={styles.footerMark}>Interviewly</span>
        <span>{t('tagline')}</span>
        {/* Locale-neutral by design — a translated copyright line says nothing new. */}
        <span>© 2026 Interviewly</span>
        <Link href="/privacy" className={styles.footerLink}>
          {t('privacy')}
        </Link>
        <Link href="/terms" className={styles.footerLink}>
          {t('terms')}
        </Link>
      </p>
    </footer>
  );
}
