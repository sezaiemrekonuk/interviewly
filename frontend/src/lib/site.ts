import { getPathname } from '../i18n/navigation';

import { DEFAULT_LOCALE, isLocale, locales, type Locale } from './locales';

import type { Metadata } from 'next';

/**
 * Where this deployment lives, as the metadata layer needs it.
 *
 * `PUBLIC_ORIGIN` arrives at runtime through `env_file` (compose), not as a `NEXT_PUBLIC_*`
 * build arg — so it is read here on the server rather than inlined into the client bundle,
 * and a deployment can move without a rebuild. Absolute URLs matter: Open Graph consumers
 * do not resolve relative image paths, so `metadataBase` is what makes the card work at all.
 */
export const SITE_ORIGIN = process.env.PUBLIC_ORIGIN ?? 'http://localhost';

export const SITE_NAME = 'Interviewly';

/** The routes a crawler should see. Everything else is behind a session and stays out. */
export const PUBLIC_ROUTES = ['/', '/register', '/sign-in', '/privacy', '/terms'] as const;

export type PublicRoute = (typeof PUBLIC_ROUTES)[number];

/**
 * The `<link rel="canonical">` and `<link rel="alternate" hreflang>` set for one public route,
 * as `generateMetadata` wants it.
 *
 * Issue 91: both languages used to answer on the same URL, so there was nothing to point an
 * hreflang at. Now that `/` is English and `/tr` is Turkish, every public route has to name its
 * own address and its counterpart's — reciprocally, or Google discards the pair — and
 * `x-default` names the one an unmatched visitor is sent to, which is the default locale by
 * construction (`localePrefix: 'as-needed'`).
 *
 * `getPathname` rather than string concatenation: it is the same function the `Link` component
 * uses, so the tags cannot drift from the URLs the app actually links to. Paths, not origins —
 * Next resolves them against the root layout's `metadataBase`.
 *
 * `locale` is a `string` because that is what a URL segment is; the root layout has already
 * 404'd anything unknown, so the fallback here is unreachable rather than lenient.
 */
export function alternatesFor(route: PublicRoute, locale: string): Metadata['alternates'] {
  const current = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const forLocale = (target: Locale) => getPathname({ href: route, locale: target });

  return {
    canonical: forLocale(current),
    languages: {
      ...Object.fromEntries(locales.map((target) => [target, forLocale(target)])),
      'x-default': forLocale(DEFAULT_LOCALE),
    },
  };
}

/**
 * Surfaces that must never be indexed. They redirect or 401 for an anonymous crawler, so they
 * would land in Search Console as soft-404s and spend crawl budget that belongs to the pages
 * that should rank.
 */
export const PRIVATE_ROUTES = ['/admin', '/dashboard', '/interviews', '/onboarding', '/profile', '/settings', '/api'] as const;
