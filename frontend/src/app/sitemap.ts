import type { MetadataRoute } from 'next';

import { PUBLIC_ROUTES, SITE_ORIGIN } from '../lib/site';

/**
 * Issue 93. With no sitemap and no internal links out of the footer, a crawler sees three
 * URLs total — the landing page and whatever it can reach from it.
 *
 * Public routes only. A signed-in surface in here would be an invitation to crawl exactly
 * what `robots.ts` disallows.
 *
 * No `alternates.languages` yet, deliberately: Turkish has no URL of its own — the locale is
 * a cookie (issue 91) — so every hreflang entry would point at the same address and tell a
 * crawler that two languages live at one URL, which is worse than saying nothing. This is the
 * file that gains them the day 91 lands.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return PUBLIC_ROUTES.map((route) => ({
    url: new URL(route, SITE_ORIGIN).toString(),
    lastModified,
    changeFrequency: 'monthly' as const,
    // The landing page is the entry point; the rest are supporting surfaces.
    priority: route === '/' ? 1 : 0.6,
  }));
}
