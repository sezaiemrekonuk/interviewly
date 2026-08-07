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
  const KNOWN_DEAD = new Set([
    // Rendered by nothing: only AvatarPreload is imported from this module, and the room no
    // longer displays avatars at all. Slated for deletion — see the redesign notes.
    'components/avatar.tsx',
  ]);

  it('no component sets style={{…}}', () => {
    const offenders: string[] = [];
    for (const file of TSX) {
      if (KNOWN_DEAD.has(rel(file))) continue;
      const src = readFileSync(file, 'utf8');
      if (/\sstyle=\{/.test(src)) offenders.push(rel(file));
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
