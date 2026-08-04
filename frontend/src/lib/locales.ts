// Client- and server-safe: `i18n.ts` pulls in `next/headers`, so a client component
// cannot import the locale list from there.
export const locales = ['en', 'tr'] as const;
export type Locale = (typeof locales)[number];

/** Written by `<LocaleSwitcher>`, read by `i18n.ts`. No locale path segment exists. */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export function writeLocaleCookie(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}
