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
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
