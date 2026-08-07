'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { locales, writeLocaleCookie, type Locale } from '../lib/locales';
import { useSaveLocale } from '../lib/query';

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
  const saveLocale = useSaveLocale();

  function select(locale: Locale) {
    // Cookie first, and the refresh does not wait on the account write: the cookie is what
    // next-intl reads, so the interface switches at the same speed it always did — signed in
    // or not, network or not. The PATCH is the half that reaches mail and the interview
    // (issue 76), and a visitor with no session is simply refused it.
    writeLocaleCookie(locale);
    saveLocale.mutate(locale);
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
