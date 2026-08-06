// #66 — every codepoint used in messages/tr.json (and en.json) must be present in the cmap of
// both self-hosted webfonts. The Google "latin" subset migration silently dropped İ ğ Ğ ş Ş
// (Latin Extended-A) and those letters fell back to the OS UI font mid-word, forever, because
// of display: swap. This test decodes the real woff2 cmaps, not a hardcoded list, so a future
// re-subset that drops a glyph fails here instead of shipping.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fontkit from 'fontkit';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const FONTS = {
  inter: join(ROOT, 'public', 'fonts', 'inter-latin.woff2'),
  outfit: join(ROOT, 'public', 'fonts', 'outfit-latin.woff2'),
};

function messageChars(file: string): Set<string> {
  const json = JSON.parse(readFileSync(join(ROOT, 'messages', file), 'utf8'));
  const chars = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      for (const ch of value) chars.add(ch);
    } else if (value && typeof value === 'object') {
      for (const v of Object.values(value)) walk(v);
    }
  };
  walk(json);
  return chars;
}

function cmapCodepoints(path: string): Set<number> {
  const font = fontkit.openSync(path);
  return new Set(font.characterSet);
}

describe('webfont cmap covers every message character (#66)', () => {
  for (const [name, path] of Object.entries(FONTS)) {
    it(`${name}-latin.woff2 has every codepoint used in tr.json and en.json`, () => {
      const covered = cmapCodepoints(path);
      const used = new Set([...messageChars('tr.json'), ...messageChars('en.json')]);
      const missing = [...used].filter((ch) => {
        const cp = ch.codePointAt(0)!;
        // Whitespace/control chars aren't glyphs; skip them.
        if (cp < 0x20 || cp === 0x7f) return false;
        return !covered.has(cp);
      });
      expect(missing).toEqual([]);
    });
  }

  it('the five previously-missing Turkish glyphs are present in both fonts', () => {
    const required = ['İ', 'ğ', 'Ğ', 'ş', 'Ş'].map((c) => c.codePointAt(0)!);
    for (const path of Object.values(FONTS)) {
      const covered = cmapCodepoints(path);
      for (const cp of required) {
        expect(covered.has(cp)).toBe(true);
      }
    }
  });
});
