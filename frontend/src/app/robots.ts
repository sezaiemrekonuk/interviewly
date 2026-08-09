import type { MetadataRoute } from 'next';

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
      disallow: PRIVATE_ROUTES.map((route) => `${route}/`),
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
