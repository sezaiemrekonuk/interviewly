import { describe, expect, it } from 'vitest';

import { DEFAULT_LANDING_PATH, safeReturnPath, signInPathFor } from './auth-redirect';

describe('safeReturnPath', () => {
  // The landing path is the authed home at `/`; a `/dashboard` route has never existed, and
  // pointing here sent every sign-in to a 404.
  it('falls back to the authed landing surface', () => {
    // `/` is marketing for everyone now; the briefing is its own route.
    expect(DEFAULT_LANDING_PATH).toBe('/dashboard');
  });

  it('keeps a same-origin path', () => {
    expect(safeReturnPath('/interviews/abc')).toBe('/interviews/abc');
    expect(safeReturnPath('/interviews?tab=reports')).toBe('/interviews?tab=reports');
  });

  it('keeps the extension landing whole, query and all', () => {
    const landing = '/interviews/new?prefill=Backend%20engineer&jobTitle=Backend&jobCompany=Acme&jobId=4242';
    expect(safeReturnPath(landing)).toBe(landing);
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
    '//evil.example/phish?prefill=x',
    '/\\evil.example/phish?prefill=x',
  ])('refuses %s', (hostile) => {
    expect(safeReturnPath(hostile)).toBe(DEFAULT_LANDING_PATH);
  });
});

describe('signInPathFor', () => {
  it('encodes the path so query and hash cannot break out of the parameter', () => {
    expect(signInPathFor('/interviews/abc')).toBe('/sign-in?returnPath=%2Finterviews%2Fabc');
    expect(signInPathFor('/a?b=c#d')).toBe('/sign-in?returnPath=%2Fa%3Fb%3Dc%23d');
  });

  it('carries the search string, so an extension landing survives sign-in', () => {
    const path = signInPathFor('/interviews/new', '?prefill=Backend&jobId=4242');

    expect(path).toBe('/sign-in?returnPath=%2Finterviews%2Fnew%3Fprefill%3DBackend%26jobId%3D4242');
    expect(new URLSearchParams(path.slice(path.indexOf('?'))).get('returnPath')).toBe(
      '/interviews/new?prefill=Backend&jobId=4242',
    );
  });
});
