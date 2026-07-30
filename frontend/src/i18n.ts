import { notFound } from 'next/navigation';
import { getRequestConfig } from 'next-intl/server';

export const locales = ['en', 'tr'] as const;
export type Locale = typeof locales[number];

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = (requested && locales.includes(requested as Locale))
    ? (requested as Locale)
    : (process.env.NEXT_PUBLIC_DEFAULT_LOCALE as Locale) ?? 'en';
  if (!locales.includes(locale)) notFound();
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
