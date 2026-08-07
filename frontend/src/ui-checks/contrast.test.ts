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
const danger = token('--danger');
const live = token('--live');
const bg = token('--bg');
const surface = token('--surface');
const sunken = token('--surface-sunken');
const stage = token('--stage');
const rail = token('--rail');
const railRaised = token('--rail-raised');
const railText = token('--rail-text');
const railTextMuted = token('--rail-text-muted');
const railTextFaint = token('--rail-text-faint');
const white = '#FFFFFF';

const pairs: Array<[string, string, string]> = [
  ['--text over --bg', text, bg],
  ['--text over --surface', text, surface],
  ['--text over --surface-sunken', text, sunken],
  ['--text-muted over --bg', textMuted, bg],
  ['--text-muted over --surface', textMuted, surface],
  ['--text-muted over --surface-sunken', textMuted, sunken],
  // The stage is the interview room's ground. Nothing sits on it bare today — every tile and
  // sheet carries its own background — but it is a legal ground, and the first caption placed
  // directly on it must not be the thing that discovers it was never checked.
  ['--text over --stage', text, stage],
  ['--text-muted over --stage', textMuted, stage],
  ['--danger over --stage', danger, stage],
  // The context column is a second full ground with its own ink ramp. `--rail-text-faint` on
  // `--rail-raised` (the current nav item) is the tightest pair in the whole system.
  ['--rail-text over --rail', railText, rail],
  ['--rail-text over --rail-raised', railText, railRaised],
  ['--rail-text-muted over --rail', railTextMuted, rail],
  ['--rail-text-muted over --rail-raised', railTextMuted, railRaised],
  ['--rail-text-faint over --rail', railTextFaint, rail],
  ['--rail-text-faint over --rail-raised', railTextFaint, railRaised],
  ['white on --primary', white, primary],
  ['white on --live', white, live],
  // Error copy is 13px and lands on all three grounds — the card, the page and the
  // sunken bed a banner sits on. The spec's #EF4444 cleared none of them.
  ['--danger over --bg', danger, bg],
  ['--danger over --surface', danger, surface],
  ['--danger over --surface-sunken', danger, sunken],
];

describe('AA contrast floor (ui AC-2, ≥ 4.5:1)', () => {
  for (const [label, fg, bgHex] of pairs) {
    it(`${label} clears ${AA_FLOOR}:1`, () => {
      expect(contrastRatio(fg, bgHex)).toBeGreaterThanOrEqual(AA_FLOOR);
    });
  }
});
