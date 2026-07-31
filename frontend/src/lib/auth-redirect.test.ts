import { describe, expect, it } from 'vitest';

import { DEFAULT_LANDING_PATH, safeReturnPath, signInPathFor } from './auth-redirect';

describe('safeReturnPath', () => {
  it('keeps a same-origin path', () => {
    expect(safeReturnPath('/interviews/abc')).toBe('/interviews/abc');
    expect(safeReturnPath('/dashboard?tab=reports')).toBe('/dashboard?tab=reports');
  });

  it('falls back when nothing was requested', () => {
    expect(safeReturnPath(null)).toBe(DEFAULT_LANDING_PATH);
    expect(safeReturnPath(undefined)).toBe(DEFAULT_LANDING_PATH);
    expect(safeReturnPath('')).toBe(DEFAULT_LANDING_PATH);
  });

  it.each([
    'https://evil.example/phish',
    'http://evil.example/phish',
    // Protocol-relative and backslash-smuggled forms both start with a slash, which is
    // why `startsWith('/')` on its own is not an open-redirect defence.
    '//evil.example/phish',
    '/\\evil.example/phish',
    'javascript:alert(1)',
    'evil.example',
  ])('refuses %s', (hostile) => {
    expect(safeReturnPath(hostile)).toBe(DEFAULT_LANDING_PATH);
  });
});

describe('signInPathFor', () => {
  it('encodes the path so query and hash cannot break out of the parameter', () => {
    expect(signInPathFor('/interviews/abc')).toBe('/sign-in?returnPath=%2Finterviews%2Fabc');
    expect(signInPathFor('/a?b=c#d')).toBe('/sign-in?returnPath=%2Fa%3Fb%3Dc%23d');
  });
});
