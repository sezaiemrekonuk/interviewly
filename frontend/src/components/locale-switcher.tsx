'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { locales, writeLocaleCookie, type Locale } from '../lib/locales';

import styles from './locale-switcher.module.css';

/**
 * §4.8 — UI copy and `errors.*` only. `interviews.language` is a separate axis and is
 * never touched from here: switching the interface to Turkish must not re-language a
 * running interview.
 *
 * Rendered as a segmented pill: the short code carries the visual, the full language name
 * carries the accessible name, and `aria-pressed` carries the state (never colour alone).
 */
export function LocaleSwitcher() {
  const t = useTranslations('common');
  const active = useLocale();
  const router = useRouter();

  function select(locale: Locale) {
    writeLocaleCookie(locale);
    router.refresh();
  }

  const label: Record<Locale, string> = {
    en: t('localeEnglish'),
    tr: t('localeTurkish'),
  };

  return (
    <div role="group" aria-label={t('locale')} className={styles.track}>
      {locales.map((locale) => {
        const isActive = locale === active;
        return (
          <button
            key={locale}
            type="button"
            onClick={() => select(locale)}
            aria-pressed={isActive}
            aria-label={label[locale]}
            className={isActive ? `${styles.segment} ${styles.segmentActive}` : styles.segment}
          >
            {locale.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
