import { ImageResponse } from 'next/og';
import { getLocale, getTranslations } from 'next-intl/server';

import { MarkImage } from '../lib/brand-mark-image';
import { token } from '../lib/design-tokens';
import { SITE_NAME } from '../lib/site';

export const alt = SITE_NAME;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Issue 93. Generated from the token registry rather than shipped as a binary, so it cannot
 * drift from the brand the way an exported PNG does — and so the colours obey DESIGN.md §2
 * instead of being three hex literals in an asset nobody re-exports.
 *
 * Type-only, deliberately: the mascot artwork is a 1×1 placeholder today (issue 125), and a
 * card built around a missing illustration would be worse than one built around the sentence
 * the product actually leads with.
 *
 * Above the `[locale]` segment, so `getLocale()` resolves to the default locale (issue 91).
 * That is what a scraper saw anyway — it arrives with no cookie and never had a locale to
 * negotiate from — and one card at one address is what both languages' metadata points at.
 */
export default async function Image() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'landing' });

  const rail = token('--rail');
  const railText = token('--rail-text');
  const railTextMuted = token('--rail-text-muted');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 80,
          background: rail,
          // Serif is the display role (layout.tsx); satori has no access to the woff2, so this
          // names the family generically rather than shipping a fourth copy of the font.
          fontFamily: 'serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <MarkImage unit={1.6} stem={railText} />
          <div style={{ fontSize: 30, color: railText, letterSpacing: -0.5 }}>{SITE_NAME}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ fontSize: 68, color: railText, lineHeight: 1.1, letterSpacing: -1.5 }}>
            {t('hero')}
          </div>
          <div style={{ fontSize: 30, color: railTextMuted, lineHeight: 1.4, maxWidth: 900 }}>
            {t('subhead')}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
