import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';

import { routing } from './i18n/routing';

const handleLocale = createMiddleware(routing);

// Next injects inline bootstrap/hydration scripts on every page, so a static
// `default-src 'self'` CSP (as previously set at the edge) blocks them outright and
// the app never hydrates. Per-request nonce lets those scripts run without 'unsafe-inline'.
function policy(nonce: string): string {
  // S05 narrowed `connect-src` back to 'self': the ElevenLabs socket allowance existed for the
  // agent dial ADR-S01 removed, and the browser now talks only to this origin (speech AC-9).
  return `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';`;
}

/**
 * Metadata routes, which Next serves from `app/` itself rather than from a page. They carry no
 * locale and must reach Next at the path they were requested at — rewritten into `/en/…` they
 * 404, which silently costs the site its sitemap and its favicon. Dotted paths
 * (`sitemap.xml`, `robots.txt`, `manifest.webmanifest`) are already excluded by the matcher;
 * these three have no extension, so they are named here.
 */
const METADATA_ROUTE = /^\/(?:icon|apple-icon|opengraph-image)$/;

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = policy(nonce);

  // Set on the *request*, not just the response: Next reads the nonce back out of this header
  // to stamp its own inline scripts. next-intl builds its response from a copy of the headers
  // it is handed, so the nonce has to be in place before it runs — hence a forwarded request
  // rather than a mutation of the response afterwards.
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);

  const response = METADATA_ROUTE.test(request.nextUrl.pathname)
    ? NextResponse.next({ request: { headers } })
    : handleLocale(new NextRequest(request, { headers }));

  response.headers.set('Content-Security-Policy', csp);
  // No `Vary` here. Which URL an unprefixed path resolves to *is* negotiated from the locale
  // cookie and then `Accept-Language` (issue 91), so it belongs on these responses — but Next
  // rebuilds `Vary` from its own RSC entries when it renders a page, and a header set here is
  // gone by the time the browser sees it. It is set at the edge instead, in the `Caddyfile`,
  // which is also where a cache would ever sit.
  return response;
}

export const config = {
  // `.*\..*` excludes every path with an extension — the static chunks Next fingerprints, and
  // the metadata routes that end in one. Everything else is a page and needs both halves.
  matcher: ['/((?!_next/static|_next/image|.*\\..*).*)'],
};
