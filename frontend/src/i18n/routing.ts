import { defineRouting } from 'next-intl/routing';

import { DEFAULT_LOCALE, LOCALE_COOKIE, locales } from '../lib/locales';

/**
 * Issue 91. The interface language used to live entirely in a cookie, so both languages
 * answered on the same URL: Googlebot arrives without a cookie and only ever saw English, and
 * a Turkish reader could not send anyone the page they were reading. Turkish is the primary
 * market, so "the Turkish site has no address" was the whole of it.
 *
 * `as-needed` rather than `always`: the default locale keeps the bare URL, so every link that
 * already exists in the wild — and every path the API mails out (`worker/src/jobs/
 * email-send.ts`) — still resolves, while Turkish gains `/tr/…`. The middleware negotiates an
 * unprefixed request from the cookie and then `Accept-Language`, so a first-time Turkish
 * visitor is redirected to the Turkish URL instead of being shown English at a URL that
 * cannot say it is Turkish.
 *
 * `alternateLinks: false` turns off next-intl's blanket `Link:` response header. It would
 * advertise an hreflang pair for `/dashboard` and `/admin` too — pages whose own metadata
 * says `noindex`, which is a contradiction to hand a crawler. The public routes emit real
 * `<link rel="alternate">` tags instead, via `alternatesFor` in `lib/site.ts`.
 */
export const routing = defineRouting({
  locales,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
  localeCookie: { name: LOCALE_COOKIE, maxAge: 31536000, sameSite: 'lax' },
  alternateLinks: false,
});
