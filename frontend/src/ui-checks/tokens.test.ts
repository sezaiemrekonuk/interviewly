// W01 AC-1 — every `--` token in ui §4.2 exists exactly once in tokens.css with its shipped
// value, and no literal (hex/px/spacing/shadow/font) leaks into src/** or globals.css outside
// the registry. Asserts the *shipped* values (F01 darkened text-muted/primary/live for AA),
// not the ui-spec literals.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const TOKENS_CSS = readFileSync(join(ROOT, 'styles', 'tokens.css'), 'utf8');
const SRC_DIR = join(ROOT, 'src');
const GLOBALS_CSS = join(ROOT, 'styles', 'globals.css');

const SHIPPED_TOKENS: Record<string, string> = {
  '--bg': '#FBF9F6',
  '--surface': '#FFFFFF',
  '--surface-sunken': '#F4F2EE',
  '--text': '#111436',
  '--text-muted': '#646884',
  '--primary': '#C94D00',
  '--primary-soft': '#FFF1E8',
  '--accent': '#6F76F1',
  '--live': '#12873D',
  '--success': '#10B981',
  '--warning': '#F59E0B',
  '--danger': '#C62A20',
  '--border': '#E8E4DE',
  '--grad-lavender': '#EFE9FF',
  '--grad-cream': '#FBF9F6',
  '--grad-peach': '#FFE8D6',
  '--radius-panel': '24px',
  '--radius-card': '16px',
  '--radius-input': '12px',
  '--radius-button': '999px',
  '--shadow-hairline': '0 1px 2px rgba(17,20,54,.06)',
  '--shadow-soft': '0 8px 24px -12px rgba(17,20,54,.12)',
  '--duration-default': '200ms',
  '--easing-default': 'ease-out',
};

function declaredValue(name: string): string | undefined {
  const re = new RegExp(`(?<![\\w-])${name}:\\s*([^;]+);`, 'g');
  const matches = [...TOKENS_CSS.matchAll(re)].map((m) => m[1].trim());
  // exactly-once means one declaration inside :root (the @media reduced-motion override
  // for --duration-default is the one deliberate exception, ui §4.2 motion note).
  return matches[0];
}

describe('token registry (ui §4.2)', () => {
  for (const [name, value] of Object.entries(SHIPPED_TOKENS)) {
    it(`${name} exists exactly once with its shipped value`, () => {
      const occurrences = TOKENS_CSS.split(`${name}:`).length - 1;
      const expectedOccurrences = name === '--duration-default' ? 2 : 1;
      expect(occurrences).toBe(expectedOccurrences);
      expect(declaredValue(name)).toBe(value);
    });
  }

  it('--gradient-entry composes the three gradient stops', () => {
    expect(declaredValue('--gradient-entry')).toBe(
      'linear-gradient(160deg, var(--grad-lavender) 0%, var(--grad-cream) 52%, var(--grad-peach) 100%)'
    );
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

describe('no stray literals outside the token registry', () => {
  it('no raw colour hex in src/** or globals.css', () => {
    const violations: string[] = [];
    for (const file of SCAN_FILES) {
      const content = readFileSync(file, 'utf8');
      for (const match of content.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
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
