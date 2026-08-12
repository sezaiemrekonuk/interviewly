import { token } from './design-tokens';

/**
 * The mark, for the `ImageResponse` routes — `icon`, `apple-icon`, `opengraph-image`.
 *
 * Same two bars as `components/brand-mark.tsx`, redrawn in divs because satori rasterises a
 * flex tree, not SVG. The geometry is that component's viewBox (a 6-wide stem 20 tall, a
 * 3 gap, a 6-wide answering bar 10 tall) times `unit`, so the three generated sizes and the
 * in-app mark stay one shape: change the proportions in one place and they all move.
 *
 * The radius is `unit / 2` rather than the component's proportional `1`: scaled honestly to
 * 512 that lands at 16px and the bars read as lozenges, which is the opposite of the
 * near-square corners §2 asks for. Half of it keeps them square at every size the set uses.
 *
 * Colours come from the registry rather than from arguments — the whole reason these routes
 * are code and not checked-in PNGs (DESIGN.md §2). `stem` is passed because it is the only
 * value that genuinely differs per surface: on the icons it is the rail's ink, on the OG card
 * it is the same but the caller has already read it.
 */
export function MarkImage({ unit, stem }: { unit: number; stem: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 3 * unit }}>
      <div
        style={{
          width: 6 * unit,
          height: 20 * unit,
          borderRadius: unit / 2,
          background: stem,
        }}
      />
      <div
        style={{
          width: 6 * unit,
          height: 10 * unit,
          borderRadius: unit / 2,
          background: token('--primary'),
        }}
      />
    </div>
  );
}
