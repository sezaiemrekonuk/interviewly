import { useTranslations } from 'next-intl';

import styles from './chrome.module.css';

/** One quiet line: who we are, what we do, and the year. Nothing to click. */
export function SiteFooter() {
  const t = useTranslations('chrome');

  return (
    <footer className={styles.footer}>
      <p className={styles.line}>
        <span className={styles.footerMark}>Interviewly</span>
        <span>{t('tagline')}</span>
        {/* Locale-neutral by design — a translated copyright line says nothing new. */}
        <span>© 2026 Interviewly</span>
      </p>
    </footer>
  );
}
