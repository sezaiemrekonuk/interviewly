import type { MetadataRoute } from 'next';

import { getPathname } from '../i18n/navigation';
import { locales } from '../lib/locales';
import { PRIVATE_ROUTES, SITE_ORIGIN } from '../lib/site';

/**
 * Issue 93. There was no `robots.txt` at all, so every signed-in surface — `/admin`,
 * `/dashboard`, `/interviews/*` — was fair game. Those all 401 or redirect for a crawler,
 * which is worse than being disallowed: they burn crawl budget and land in Search Console as
 * soft-404s, which suppresses the pages that should rank.
 *
 * The `disallow` list is a request, not enforcement — `robots: { index: false }` on each
 * private route's own metadata is the half a misbehaving crawler cannot ignore. Both, so the
 * policy is stated where it is discoverable and enforced where it counts.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // No trailing slash. `Disallow: /admin/` is a prefix match that covers `/admin/foo` and
      // NOT `/admin` — which is the URL Next actually serves, so the trailing-slash form left
      // every one of these routes crawlable. Without it the prefix covers the bare path, the
      // slashed path and everything under it.
      //
      // Once per locale, because each one is a real address since issue 91: `/dashboard` and
      // `/tr/dashboard` are two URLs, and a rule naming only the first leaves the Turkish half
      // of the signed-in app crawlable. `getPathname` collapses the duplicate for whichever
      // locale owns the bare path.
      disallow: [
        ...new Set(
          PRIVATE_ROUTES.flatMap((route) =>
            locales.map((locale) => getPathname({ href: route, locale })),
          ),
        ),
      ],
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    // A hostname, not an origin: the non-standard `Host` directive takes no scheme.
    host: new URL(SITE_ORIGIN).host,
  };
}
