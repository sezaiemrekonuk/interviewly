// Issue 112 — the `errors` namespace is the only place an error code may live, and it must
// cover the registry exactly.
//
// Seven codes were once written twice in tr.json: correctly under `errors`, and again under
// `dashboard`, where `useErrorMessage` (which resolves everything through
// `useTranslations('errors')`) can never reach them. The duplicates were the better copy, so
// for months the shadowed strings looked like coverage while the formal ones rendered. A
// key-count check passed the whole time. These two assertions are what would have caught it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

const REGISTRY_SOURCE = readFileSync(
  join(__dirname, '..', '..', '..', 'backend', 'src', 'lib', 'error-codes.ts'),
  'utf8',
);

const CODE_SHAPE = /^[A-Z][A-Z0-9_]+$/;

// Read out of the registry source rather than imported: `error-codes.ts` is a backend module
// outside this project's tsconfig, and the shape it declares — one `CODE: { … }` entry per
// line — is stable enough to parse. Same approach as assets.test.ts with the Prisma schema.
function registryCodes(): string[] {
  const body = REGISTRY_SOURCE.slice(REGISTRY_SOURCE.indexOf('ERROR_CODES = {'));
  return [...body.matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)].map(([, code]) => code);
}

// `UNKNOWN` is the one code the backend never sends. `api.ts` raises it locally when a request
// dies before a body arrives, and `useErrorMessage` falls back to it for a code newer than the
// client — so it is owned by the frontend and belongs in the file without a registry entry.
const FRONTEND_ONLY = ['UNKNOWN'];

function misfiledCodes(messages: object): string[] {
  const walk = (node: unknown, path: string[]): string[] => {
    if (typeof node !== 'object' || node === null) return [];
    return Object.entries(node).flatMap(([key, value]) => {
      const here = [...path, key];
      const misfiled = path[0] !== 'errors' && CODE_SHAPE.test(key) ? [here.join('.')] : [];
      return [...misfiled, ...walk(value, here)];
    });
  };
  return walk(messages, []);
}

// Guard against a broken parse: this suite becomes meaningless if we cannot find the registry
// marker or at least one known code in the parsed result.
const REGISTRY_SENTINELS = ['PASSWORD_TOO_SHORT', 'CONSENT_REQUIRED'];

describe('error codes', () => {
  const expected = [...registryCodes(), ...FRONTEND_ONLY].sort();

  it('reads the registry it is asserting against', () => {
    expect(REGISTRY_SOURCE).toContain('ERROR_CODES = {');
    const codes = registryCodes();
    expect(codes.length).toBeGreaterThan(0);
    for (const code of REGISTRY_SENTINELS) expect(codes).toContain(code);
  });

  it.each([
    ['en', en],
    ['tr', tr],
  ])('covers the registry exactly in %s', (_locale, messages) => {
    expect(Object.keys(messages.errors).sort()).toEqual(expected);
  });

  it.each([
    ['en', en],
    ['tr', tr],
  ])('defines no error code outside the errors namespace in %s', (_locale, messages) => {
    expect(misfiledCodes(messages)).toEqual([]);
  });
});
