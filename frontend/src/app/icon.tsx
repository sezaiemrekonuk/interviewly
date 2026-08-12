import { ImageResponse } from 'next/og';

import { MarkImage } from '../lib/brand-mark-image';
import { token } from '../lib/design-tokens';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

/**
 * The manifest icon (issue 93). Generated from the token registry for the reason
 * `opengraph-image.tsx` gives: a checked-in PNG carries brand colours nothing can lint, and
 * drifts the first time the palette moves.
 *
 * `favicon.ico` stays where it is — browsers still ask for it by name, and Next serves it
 * from `app/` alongside these. It is the same mark, hand-rastered at 16 and 32 (there is no
 * generator route for `.ico`), so a palette move has to redraw it; that is the one asset in
 * the set the registry cannot reach.
 *
 * `unit: 16` puts the 15×20 mark at 240×320 inside 512 — 136px of margin on the sides and 96
 * top and bottom, which survives the circular crop a launcher may apply.
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
        }}
      >
        <MarkImage unit={16} stem={token('--rail-text')} />
      </div>
    ),
    size,
  );
}
