import styles from './brand-mark.module.css';

/**
 * The mark: two bars taking turns — the tall one asks, the short one answers. That is the
 * whole product in two rectangles, and at 15px wide it still reads as two, which a glyph
 * with interior detail does not.
 *
 * Drawn, not fetched: one fewer request, and no second file to re-export when the palette
 * moves. The stem is `currentColor` so the same mark works on the rail's ink ramp and on the
 * light chrome — the CSS-drawn glyph this replaced could not, because its knockout was a
 * hard `var(--rail)` and went invisible the moment it left the rail.
 *
 * Fills live in the module rather than on `fill=` attributes: the production CSP is
 * `style-src 'self' 'nonce-…'`, and `var()` inside a presentation attribute is not reliably
 * substituted anyway.
 *
 * The answering bar keeps `--primary` on the rail too. It sits at 2.95:1 there, under §2's
 * non-text floor — which a logotype is exempt from (WCAG 1.4.11), and `meter.module.css`
 * already puts the same fill on the same ground.
 *
 * One size, 15×20. The drawn glyph it replaces was 20px tall beside the rail's 16px wordmark,
 * and the header's 20px wordmark wants the same height — so both call sites take the same
 * mark and there is no variant to keep in sync.
 */
export function BrandMark() {
  return (
    <svg
      className={styles.mark}
      viewBox="0 0 15 20"
      width={15}
      height={20}
      aria-hidden="true"
      focusable="false"
    >
      <rect className={styles.stem} x="0" y="0" width="6" height="20" rx="1" />
      <rect className={styles.turn} x="9" y="0" width="6" height="10" rx="1" />
    </svg>
  );
}
