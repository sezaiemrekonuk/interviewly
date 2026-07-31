import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Next injects inline bootstrap/hydration scripts on every page, so a static
// `default-src 'self'` CSP (as previously set at the edge) blocks them outright and
// the app never hydrates. Per-request nonce lets those scripts run without 'unsafe-inline'.
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';`;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
