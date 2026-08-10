import type { MetadataRoute } from 'next';

import { getPathname } from '../i18n/navigation';
import { locales, type Locale } from '../lib/locales';
import { PUBLIC_ROUTES, SITE_ORIGIN } from '../lib/site';

/**
 * Issue 93. With no sitemap and no internal links out of the footer, a crawler sees three
 * URLs total — the landing page and whatever it can reach from it.
 *
 * Public routes only. A signed-in surface in here would be an invitation to crawl exactly
 * what `robots.ts` disallows.
 *
 * Both languages, one `<url>` each, and every entry carries the full `alternates.languages`
 * set including its own (issue 91). Reciprocity is the part Google enforces: an entry that
 * names its counterpart without being named back is discarded, which is why the map is built
 * once per route and shared rather than written per entry.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const absolute = (route: string, locale: Locale) =>
    new URL(getPathname({ href: route, locale }), SITE_ORIGIN).toString();

  return PUBLIC_ROUTES.flatMap((route) => {
    const languages = Object.fromEntries(
      locales.map((locale) => [locale, absolute(route, locale)]),
    );

    return locales.map((locale) => ({
      url: absolute(route, locale),
      lastModified,
      changeFrequency: 'monthly' as const,
      // The landing page is the entry point; the rest are supporting surfaces.
      priority: route === '/' ? 1 : 0.6,
      alternates: { languages },
    }));
  });
}
