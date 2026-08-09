import { ImageResponse } from 'next/og';

import { token } from '../lib/design-tokens';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

/**
 * The manifest icon (issue 93). Generated from the token registry for the reason
 * `opengraph-image.tsx` gives: a checked-in PNG carries brand colours nothing can lint, and
 * drifts the first time the palette moves.
 *
 * `favicon.ico` stays where it is — browsers still ask for it by name, and Next serves it
 * from `app/` alongside these.
 */
export default function Icon() {
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
          color: token('--rail-text'),
          fontSize: 300,
          fontFamily: 'serif',
        }}
      >
        I
      </div>
    ),
    size,
  );
}
