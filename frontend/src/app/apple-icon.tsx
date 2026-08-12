import { ImageResponse } from 'next/og';

import { MarkImage } from '../lib/brand-mark-image';
import { token } from '../lib/design-tokens';

// 180×180 is what iOS asks for; anything else is rescaled and looks it on the home screen.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/**
 * The iOS home-screen icon (issue 93). Same generation story as `icon.tsx`, at the size Apple
 * actually requests — and unlike the manifest icon this one is never masked, so it keeps the
 * full-bleed ground rather than assuming a safe area.
 *
 * `unit: 6` is 90×120 inside 180: proportionally tighter than the 512, because iOS rounds the
 * corners rather than cropping and a mark sized for a circular crop reads as lost in the tile.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: token('--rail'),
        }}
      >
        <MarkImage unit={6} stem={token('--rail-text')} />
      </div>
    ),
    size,
  );
}
