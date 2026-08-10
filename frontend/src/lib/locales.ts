// Client- and server-safe: `i18n/request.ts` pulls in `next-intl/server`, so a client
// component cannot import the locale list from there.
export const locales = ['en', 'tr'] as const;
export type Locale = (typeof locales)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/**
 * Which locale gets the bare URL. Under `localePrefix: 'as-needed'` (`i18n/routing.ts`) the
 * default locale is served unprefixed and the other one lives under `/tr`, so this value
 * decides the shape of every public URL — not just which copy renders first.
 *
 * A build arg, not a runtime var: `NEXT_PUBLIC_*` is inlined into the client bundle, and the
 * navigation helpers that build hrefs run there too.
 */
export const DEFAULT_LOCALE: Locale = isLocale(process.env.NEXT_PUBLIC_DEFAULT_LOCALE)
  ? process.env.NEXT_PUBLIC_DEFAULT_LOCALE
  : 'en';

/**
 * Written and read by next-intl itself — the middleware syncs it on every navigation and the
 * navigation helpers write it client-side before a locale switch, so nothing in this app sets
 * it by hand. It is no longer where the locale *lives*; the path segment is (issue 91). It
 * only decides which URL an unprefixed request is sent to.
 */
export const LOCALE_COOKIE = 'NEXT_LOCALE';
