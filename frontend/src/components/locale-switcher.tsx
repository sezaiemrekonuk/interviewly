'use client';

import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { usePathname, useRouter } from '../i18n/navigation';
import { locales, type Locale } from '../lib/locales';
import { useSaveLocale } from '../lib/query';

import styles from './locale-switcher.module.css';

/**
 * §4.8 — UI copy and `errors.*` only. `interviews.language` is a separate axis and is
 * never touched from here: switching the interface to Turkish must not re-language a
 * running interview.
 *
 * Rendered as a segmented pill: the short code carries the visual, the full language name
 * carries the accessible name, and `aria-pressed` carries the state (never colour alone).
 *
 * Both labels are endonyms (§4), so on either page one of them is foreign to `<html lang>`:
 * each button declares its own `lang` so a screen reader says "Türkçe" with Turkish phonemes
 * (WCAG 3.1.2).
 */
export function LocaleSwitcher() {
  const t = useTranslations('common');
  const active = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const saveLocale = useSaveLocale();

  function select(locale: Locale) {
    if (locale === active) return;

    // A navigation, not a refresh: the language is the URL now (issue 91), so switching it has
    // to move the visitor to the other language's address — otherwise the page they are
    // reading still cannot be linked or shared. `push`, so Back returns to the language they
    // came from. next-intl re-prefixes `pathname` (which arrives unprefixed) and syncs the
    // locale cookie itself; the query string is carried over because it is part of what the
    // visitor is looking at (`/interviews?status=…`).
    //
    // The PATCH is a separate axis and does not gate the navigation: it is the half that
    // reaches mail and the interview (issue 76), and a visitor with no session is simply
    // refused it.
    saveLocale.mutate(locale);
    const query = searchParams.toString();
    router.push(`${pathname}${query ? `?${query}` : ''}`, { locale });
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
            lang={locale}
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
