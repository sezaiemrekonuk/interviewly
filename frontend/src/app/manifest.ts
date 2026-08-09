import type { MetadataRoute } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

import { token } from '../lib/design-tokens';
import { SITE_NAME } from '../lib/site';

/**
 * Issue 93. With no manifest, "Add to home screen" produced an unnamed tile — a visible
 * quality signal on the platform most job seekers browse from.
 *
 * A `.ts` route rather than a static `manifest.json` for one reason: the colours have to come
 * from `styles/tokens.css` (DESIGN.md §2 — "a literal outside that file is a defect, not a
 * shortcut"), and only code can read the registry. The description is translated for the same
 * reason the metadata is.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'landing' });

  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: t('subhead'),
    lang: locale,
    start_url: '/',
    display: 'standalone',
    background_color: token('--bg'),
    theme_color: token('--rail'),
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
