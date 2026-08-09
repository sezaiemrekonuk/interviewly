// W01 AC-1 — every `--` token in ui §4.2 exists exactly once in tokens.css with its shipped
// value, and no literal (hex/px/spacing/shadow/font) leaks into src/** or globals.css outside
// the registry. Asserts the *shipped* values (F01 darkened text-muted/primary/live for AA),
// not the ui-spec literals.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const TOKENS_CSS = readFileSync(join(ROOT, 'styles', 'tokens.css'), 'utf8');
const SRC_DIR = join(ROOT, 'src');
const GLOBALS_CSS = join(ROOT, 'styles', 'globals.css');

const SHIPPED_TOKENS: Record<string, string> = {
  '--bg': '#F1F2F7',
  '--surface': '#FBFBFD',
  '--surface-sunken': '#E7E9F1',
  '--text': '#12131C',
  '--text-muted': '#565C71',
  '--primary': '#B2400A',
  '--primary-soft': '#FBEFE7',
  '--accent': '#4046CC',
  '--live': '#0C6F33',
  '--success': '#0E7A3A',
  '--warning': '#8A5A00',
  '--danger': '#B52519',
  '--border': '#CBCEDD',
  '--radius-panel': '6px',
  '--radius-card': '3px',
  '--radius-input': '2px',
  '--radius-button': '2px',
  '--shadow-hairline': '0 1px 2px rgba(18,19,28,.07), 0 10px 26px -14px rgba(18,19,28,.30)',
  '--shadow-soft': '0 2px 3px rgba(18,19,28,.05), 0 30px 60px -26px rgba(18,19,28,.42)',
  '--duration-default': '200ms',
  '--easing-default': 'ease-out',
};

// Direction B's surfaces. These carry the split shell (the dark context column, the
// interview stage) and the chart series; they have no equivalent in the old registry.
const ADDED_TOKENS: Record<string, string> = {
  '--rail': '#191B2B',
  '--rail-raised': '#232640',
  '--rail-border': '#343954',
  '--rail-text': '#F2F3F9',
  '--rail-text-muted': '#A9AECB',
  '--rail-text-faint': '#8A90B4',
  '--stage': '#D5D8E7',
  '--primary-deep': '#8F3407',
  '--accent-deep': '#383DB0',
  '--series-1': '#4046CC',
  '--series-2': '#B2400A',
  '--series-3': '#186972',
  '--series-4': '#63389A',
  '--series-5': '#0E6E33',
  '--series-6': '#7A4E00',
};

function declaredValue(name: string): string | undefined {
  const re = new RegExp(`(?<![\\w-])${name}:\\s*([^;]+);`, 'g');
  const matches = [...TOKENS_CSS.matchAll(re)].map((m) => m[1].trim());
  // exactly-once means one declaration inside :root (the @media reduced-motion override
  // for --duration-default is the one deliberate exception, ui §4.2 motion note).
  return matches[0];
}

describe('token registry (ui §4.2)', () => {
  for (const [name, value] of Object.entries({ ...SHIPPED_TOKENS, ...ADDED_TOKENS })) {
    it(`${name} exists exactly once with its shipped value`, () => {
      const occurrences = TOKENS_CSS.split(`${name}:`).length - 1;
      const expectedOccurrences = name === '--duration-default' ? 2 : 1;
      expect(occurrences).toBe(expectedOccurrences);
      expect(declaredValue(name)).toBe(value);
    });
  }

  it('the retired entry gradient is not redeclared', () => {
    // Direction B has no wash. Re-adding the token is the first step back to the old
    // identity, so it fails here rather than in review.
    for (const name of ['--gradient-entry', '--grad-lavender', '--grad-cream', '--grad-peach']) {
      expect(declaredValue(name)).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Stray-literal scan
// ---------------------------------------------------------------------------

const ALLOWED_TYPE_SIZES = new Set([13, 14, 16, 20, 28, 40, 56]);

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'ui-checks') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(tsx?|css)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

const SCAN_FILES = [...collectSourceFiles(SRC_DIR), GLOBALS_CSS].filter((f) => {
  try {
    statSync(f);
    return true;
  } catch {
    return false;
  }
});

/**
 * Third-party brand colours, which are not design decisions and must never enter the token
 * registry — Google's mark is Google's, fixed by their sign-in branding guidelines, and
 * re-pointing it at `--primary` would be a trademark violation rather than a theme.
 *
 * Deliberately keyed to the exact hexes and the one file: a stray `#fff` in `google-button.tsx`
 * still fails, and a Google hex anywhere else does too.
 */
const BRAND_HEX_EXEMPTIONS: Record<string, Set<string>> = {
  'components/auth/google-button.tsx': new Set(['#EA4335', '#4285F4', '#FBBC05', '#34A853']),
};

describe('no stray literals outside the token registry', () => {
  it('no raw colour hex in src/** or globals.css', () => {
    const violations: string[] = [];
    for (const file of SCAN_FILES) {
      const content = readFileSync(file, 'utf8');
      const rel = relative(SRC_DIR, file).replaceAll('\\', '/');
      const exempt = BRAND_HEX_EXEMPTIONS[rel];
      for (const match of content.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        if (exempt?.has(match[0])) continue;
        violations.push(`${file}: ${match[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('no off-scale type size (px) in src/**', () => {
    const violations: string[] = [];
    for (const file of SCAN_FILES) {
      const content = readFileSync(file, 'utf8');
      for (const match of content.matchAll(/font-size:\s*(\d+)px/g)) {
        const size = Number(match[1]);
        if (!ALLOWED_TYPE_SIZES.has(size)) violations.push(`${file}: ${match[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('no non-multiple-of-4 spacing (px) in src/**', () => {
    const violations: string[] = [];
    const spacingProps = /(margin|padding|gap|top|left|right|bottom)(-\w+)?:\s*(-?\d+)px/g;
    for (const file of SCAN_FILES) {
      const content = readFileSync(file, 'utf8');
      for (const match of content.matchAll(spacingProps)) {
        const px = Number(match[3]);
        if (px % 4 !== 0) violations.push(`${file}: ${match[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('no raw box-shadow outside tokens.css', () => {
    const violations: string[] = [];
    for (const file of SCAN_FILES) {
      const content = readFileSync(file, 'utf8');
      for (const match of content.matchAll(/box-shadow:\s*([^;]+);/g)) {
        if (!match[1].trim().startsWith('var(')) violations.push(`${file}: ${match[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
