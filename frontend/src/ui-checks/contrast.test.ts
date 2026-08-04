// W01 AC-2 — WCAG 2.1 relative-luminance contrast for every pinned pair. Reads values out of
// the shipped tokens.css (the trap: do not hard-code the ui-spec literals — F01 darkened
// text-muted/primary/live for this exact floor). Each gradient stop is asserted individually;
// an average over the gradient is not a floor.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const TOKENS_CSS = readFileSync(join(__dirname, '..', '..', 'styles', 'tokens.css'), 'utf8');

function token(name: string): string {
  const match = TOKENS_CSS.match(new RegExp(`(?<![\\w-])${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`token ${name} not found in tokens.css`);
  return match[1];
}

// ~15 lines, no dependency — WCAG 2.1 relative luminance + contrast ratio.
function relativeLuminance(hex: string): number {
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((c) => {
    const channel = parseInt(c, 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA: string, hexB: string): number {
  const [l1, l2] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

const AA_FLOOR = 4.5;

const text = token('--text');
const textMuted = token('--text-muted');
const primary = token('--primary');
const live = token('--live');
const bg = token('--bg');
const surface = token('--surface');
const sunken = token('--surface-sunken');
const gradLavender = token('--grad-lavender');
const gradCream = token('--grad-cream');
const gradPeach = token('--grad-peach');
const white = '#FFFFFF';

const pairs: Array<[string, string, string]> = [
  ['--text over --bg', text, bg],
  ['--text over --surface', text, surface],
  ['--text over --surface-sunken', text, sunken],
  ['--text-muted over --bg', textMuted, bg],
  ['--text-muted over --surface', textMuted, surface],
  ['--text-muted over --surface-sunken', textMuted, sunken],
  ['--text over --grad-lavender', text, gradLavender],
  ['--text over --grad-cream', text, gradCream],
  ['--text over --grad-peach', text, gradPeach],
  ['--text-muted over --grad-lavender', textMuted, gradLavender],
  ['--text-muted over --grad-cream', textMuted, gradCream],
  ['--text-muted over --grad-peach', textMuted, gradPeach],
  ['white on --primary', white, primary],
  ['white on --live', white, live],
];

describe('AA contrast floor (ui AC-2, ≥ 4.5:1)', () => {
  for (const [label, fg, bgHex] of pairs) {
    it(`${label} clears ${AA_FLOOR}:1`, () => {
      expect(contrastRatio(fg, bgHex)).toBeGreaterThanOrEqual(AA_FLOOR);
    });
  }
});
