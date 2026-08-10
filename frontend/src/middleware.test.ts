// @vitest-environment node
/**
 * Issue 91. The locale used to live only in a `NEXT_LOCALE` cookie, so `/` was two different
 * documents at one address: Googlebot arrives without a cookie and only ever saw English, and
 * a Turkish reader could not send anyone the page they were reading. What this file pins is
 * the negotiation that replaced it — which URL a request resolves to — plus the two things
 * that had to keep working while it was added: the per-request CSP nonce, and the metadata
 * routes that must not be dragged into a locale segment.
 */
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE } from './lib/locales';
import { middleware } from './middleware';

const OTHER = DEFAULT_LOCALE === 'en' ? 'tr' : 'en';

function request(path: string, headers: Record<string, string> = {}) {
  return middleware(new NextRequest(`http://localhost${path}`, { headers }));
}

/** Where Next is actually asked to render, whether the visitor was redirected or not. */
const target = (response: ReturnType<typeof request>) =>
  response.headers.get('location') ?? response.headers.get('x-middleware-rewrite') ?? null;

describe('locale negotiation', () => {
  it('serves the default locale at the bare URL, rendering it from the locale segment', () => {
    const response = request('/');

    expect(response.headers.get('location')).toBeNull();
    expect(new URL(target(response)!).pathname).toBe(`/${DEFAULT_LOCALE}`);
  });

  it('sends a first-time visitor whose browser asks for the other language to its URL', () => {
    // The acceptance criterion that has no cookie in it: nothing about this visitor has been
    // stored anywhere, and they still land on a URL that says which language they are reading.
    const response = request('/', { 'accept-language': `${OTHER}-TR,${OTHER};q=0.9` });

    expect(new URL(response.headers.get('location')!).pathname).toBe(`/${OTHER}`);
  });

  it('honours the cookie for an unprefixed path, which is what makes links keep working', () => {
    const response = request('/privacy', { cookie: `NEXT_LOCALE=${OTHER}` });

    expect(new URL(response.headers.get('location')!).pathname).toBe(`/${OTHER}/privacy`);
  });

  it('serves a prefixed URL as itself, cookie or no cookie', () => {
    // The whole point: the address decides, not the browser holding it. A shared link opens in
    // the language it was shared in.
    const response = request(`/${OTHER}/privacy`, { cookie: `NEXT_LOCALE=${DEFAULT_LOCALE}` });

    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get(`x-middleware-request-x-next-intl-locale`)).toBe(OTHER);
  });

});

describe('content security policy', () => {
  it('carries one nonce on both the response and the request Next reads it from', () => {
    // Next stamps its inline hydration scripts from the *request* header; the response header
    // is what the browser enforces. Two different nonces and the app never hydrates.
    const response = request('/');
    const sent = response.headers.get('content-security-policy')!;
    const forwarded = response.headers.get('x-middleware-request-content-security-policy');

    expect(sent).toMatch(/script-src 'self' 'nonce-[^']+'/);
    expect(forwarded).toBe(sent);
  });

  it('applies to a redirect too, and to a metadata route the locale never touches', () => {
    for (const response of [request('/', { cookie: `NEXT_LOCALE=${OTHER}` }), request('/icon')]) {
      expect(response.headers.get('content-security-policy')).toMatch(/^default-src 'self';/);
    }
  });

  // `media-src` has no default of its own — it falls back to `default-src 'self'`, which does
  // not cover `blob:`, and the room's turn loop hands `new Audio()` exactly one of those
  // (`URL.createObjectURL` on the TTS response). Blocked media fires `error` on the element,
  // which the hook reads as a fatal voice failure and downgrades the interview to text: a
  // missing directive here is a room where voice can never work.
  it('lets the room play its question audio from a blob URL', () => {
    expect(request('/').headers.get('content-security-policy')).toContain("media-src 'self' blob:");
  });

  // speech AC-9: no cross-origin connection from the built room. `blob:` above is same-document
  // data, not an origin, so it does not widen this.
  it('still allows no network origin but this one', () => {
    expect(request('/').headers.get('content-security-policy')).toContain("connect-src 'self'");
  });
});

describe('metadata routes', () => {
  // `/opengraph-image` and `/icon` are served from `app/` itself, above the locale segment.
  // Rewritten into one they 404 — which costs the site its social card and its favicon in a
  // way nothing else would report.
  it.each(['/icon', '/apple-icon', '/opengraph-image'])('leaves %s at its own address', (path) => {
    const response = request(path, { cookie: `NEXT_LOCALE=${OTHER}` });

    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });
});
