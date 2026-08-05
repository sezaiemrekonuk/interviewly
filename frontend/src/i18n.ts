import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getRequestConfig } from 'next-intl/server';

import { LOCALE_COOKIE, locales, type Locale } from './lib/locales';

export { locales, LOCALE_COOKIE };
export type { Locale };

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = (await requestLocale) ?? (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = (requested && locales.includes(requested as Locale))
    ? (requested as Locale)
    : (process.env.NEXT_PUBLIC_DEFAULT_LOCALE as Locale) ?? 'en';
  if (!locales.includes(locale)) notFound();
  return {
    locale,
    // A global `now` is what `format.relativeTime` reads when no explicit one is passed;
    // without it next-intl falls back to the environment clock and logs ENVIRONMENT_FALLBACK.
    // Call sites that must keep ticking pair this with `useNow({ updateInterval })`.
    now: new Date(),
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
