// Direction B's structural guards.
//
// This file used to pin the old system's closed "entry route" gradient list and its
// shadow-per-surface map, reading them out of `lib/entry-routes.ts`. Both rules are gone:
// there is no gradient any more, and every screen carries the split shell rather than a
// gradient-or-flat ground chosen per route. That data had no runtime consumer left — only
// this test imported it — so it was deleted with the rule.
//
// What replaced it is the set of invariants that can actually regress silently. Each one
// below has already been violated in this codebase at least once.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

function walk(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'ui-checks') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, match));
    else if (match.test(entry)) out.push(full);
  }
  return out;
}

const TSX = walk(SRC, /\.tsx$/).filter((f) => !/\.test\.tsx$/.test(f));
const CSS = walk(SRC, /\.css$/);
const rel = (f: string) => f.slice(SRC.length + 1);

describe('the retired identity stays retired', () => {
  it('nothing references the entry gradient or its stops', () => {
    const offenders: string[] = [];
    for (const file of [...TSX, ...CSS]) {
      const src = readFileSync(file, 'utf8');
      for (const name of ['--gradient-entry', '--grad-lavender', '--grad-cream', '--grad-peach']) {
        if (src.includes(name)) offenders.push(`${rel(file)}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('CSP: no inline style attributes', () => {
  // `style-src 'self' 'nonce-…'` drops style attributes in PRODUCTION ONLY — they work in
  // dev, which is exactly how three meters (room progress, pre-join mic level, profile
  // completeness) shipped rendering at zero width. Dynamic sizing goes through
  // components/shell/meter.tsx or a class variant.
  const KNOWN_DEAD = new Set<string>([]);

  /**
   * Next metadata images (issue 93). These are rendered by satori on the server into a PNG and
   * never reach a browser, so there is no CSP to violate — and satori supports *only* inline
   * styles, so a class would not render at all. Listed by exact path: a `style={{…}}` in any
   * other file is still the production-only bug this check exists to catch.
   */
  const SERVER_RENDERED_IMAGES = new Set([
    'app/opengraph-image.tsx',
    'app/icon.tsx',
    'app/apple-icon.tsx',
  ]);

  it('no component sets style={{…}}', () => {
    const offenders: string[] = [];
    for (const file of TSX) {
      if (KNOWN_DEAD.has(rel(file)) || SERVER_RENDERED_IMAGES.has(rel(file))) continue;
      const src = readFileSync(file, 'utf8');
      if (/\sstyle=\{/.test(src)) offenders.push(rel(file));
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Issue 201 — a CSS module declaring the same selector twice.
 *
 * CSS Modules compiles both copies to one class name, so both rules apply and the later one
 * wins. `report.module.css` carried an entire pre-redesign stylesheet below the new one that
 * way, and for seven selectors the old rules won: a `role="alert"` node in the rail rendered
 * at 2.57:1 for months (issue 200). The diff that causes this adds a well-formed rule, so
 * review does not see it either.
 *
 * The scan is only as good as its two exclusions, and getting them wrong is not theoretical —
 * a first pass without them reported duplicates in seven files and sent this check to the back
 * of a repo-wide cleanup that was never needed. Each has its own test below.
 */
function duplicateSelectors(source: string): string[] {
  const solo = new Map<string, number>();
  const grouped = new Set<string>();
  let depth = 0;
  let head = '';

  for (const char of source.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (char === '}') {
      depth -= 1;
      head = '';
      continue;
    }
    if (char !== '{') {
      if (depth === 0) head += char;
      continue;
    }

    if (depth !== 0) {
      depth += 1;
      head = '';
      continue;
    }

    const selectors = head
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // Nesting depth, not indentation: a rule under `@media` is skipped because it is inside
    // that block, however it happens to be formatted. Overriding under a breakpoint is what a
    // media query is for. Heads that are not class selectors (`@media …`, `@keyframes …`, and
    // the `from`/`to` inside one) fall out here too.
    if (depth === 0 && selectors.length > 0 && selectors.every((s) => s.startsWith('.'))) {
      // `.verified, .unverified { … }` followed by `.unverified { color: … }` is the house
      // base-plus-variant idiom, not a duplicate: the group carries what they share and the
      // single rule carries what differs. Counting the group as an occurrence of each of its
      // members is the mistake that made this check look repo-wide.
      if (selectors.length > 1) selectors.forEach((s) => grouped.add(s));
      else solo.set(selectors[0], (solo.get(selectors[0]) ?? 0) + 1);
    }

    depth += 1;
    head = '';
  }

  return [...solo]
    .filter(([selector, count]) => count > 1 && !grouped.has(selector))
    .map(([selector]) => selector);
}

describe('no CSS module declares a selector twice', () => {
  it('flags a selector declared twice at top level', () => {
    expect(duplicateSelectors('.body { color: red; }\n.body { max-width: 70ch; }')).toEqual([
      '.body',
    ]);
  });

  // The group is written one selector per line, so its last line reads as a rule head of its
  // own to anything matching line-by-line — which is why the repeated selector sits last here.
  it('does not flag the base-plus-variant idiom', () => {
    const source = `.verified,
.unverified {
  font-size: 13px;
}

.unverified {
  color: var(--warning);
}`;
    expect(duplicateSelectors(source)).toEqual([]);
  });

  // Both forms, because indentation must not be what saves us: an unindented rule inside a
  // media block is the case a formatting-based scan waves through.
  it.each([
    ['indented', '@media (max-width: 720px) {\n  .rail {\n    padding: 12px;\n  }\n}'],
    ['unindented', '@media (max-width: 720px) {\n.rail {\n  padding: 12px;\n}\n}'],
  ])('does not flag a rule repeated inside a %s media query', (_form, block) => {
    expect(duplicateSelectors(`.rail {\n  padding: 24px;\n}\n\n${block}`)).toEqual([]);
  });

  it('no CSS module in the repo carries a duplicate selector', () => {
    const offenders: string[] = [];
    for (const file of CSS.filter((f) => /\.module\.css$/.test(f))) {
      for (const selector of duplicateSelectors(readFileSync(file, 'utf8'))) {
        offenders.push(`${rel(file)}: ${selector}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the spacing lint cannot be tripped by a border', () => {
  // `border-top: 1px` fails the multiple-of-4 spacing scan in tokens.test.ts, because that
  // regex matches the `top: 1px` inside it. The house convention is logical properties, which
  // are also the correct thing for a bidi-capable product.
  it('stylesheets use logical border properties', () => {
    const offenders: string[] = [];
    for (const file of CSS) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/border-(top|bottom|left|right):/g)) {
        offenders.push(`${rel(file)}: border-${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
