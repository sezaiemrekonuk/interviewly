'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { locales, writeLocaleCookie, type Locale } from '../lib/locales';

/**
 * §4.8 — UI copy and `errors.*` only. `interviews.language` is a separate axis and is
 * never touched from here: switching the interface to Turkish must not re-language a
 * running interview.
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
    <div role="group" aria-label={t('locale')}>
      {locales.map((locale) => (
        <button
          key={locale}
          type="button"
          onClick={() => select(locale)}
          aria-pressed={locale === active}
        >
          {label[locale]}
        </button>
      ))}
    </div>
  );
}
