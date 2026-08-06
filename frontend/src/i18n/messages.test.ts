/**
 * Locale parity. `frontend/src/i18n.ts` picks a message file per request, so a key that
 * exists in one file and not the other is not a typo — it is a screen that renders its own
 * key name to half the users. Asserted as a set comparison in both directions so neither
 * file can be the one that quietly leads.
 *
 * Arrays are walked by index (`legal.privacy.sections.0.heading`): a translation with one
 * section fewer than the original is exactly the failure this exists to catch.
 */
import { describe, expect, it } from 'vitest';

import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => keyPaths(item, `${prefix}.${index}`));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      keyPaths(item, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

describe('message files', () => {
  const enKeys = keyPaths(en);
  const trKeys = keyPaths(tr);

  it('carries every English key in Turkish', () => {
    expect(enKeys.filter((key) => !trKeys.includes(key))).toEqual([]);
  });

  it('carries every Turkish key in English', () => {
    expect(trKeys.filter((key) => !enKeys.includes(key))).toEqual([]);
  });

  it('leaves no message empty in either locale', () => {
    const empty = (source: object) =>
      keyPaths(source).filter((path) => {
        const value = path
          .split('.')
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], source);
        return typeof value === 'string' && value.trim() === '';
      });
    expect(empty(en)).toEqual([]);
    expect(empty(tr)).toEqual([]);
  });
});
