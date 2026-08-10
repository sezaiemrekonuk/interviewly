import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Next injects inline bootstrap/hydration scripts on every page, so a static
// `default-src 'self'` CSP (as previously set at the edge) blocks them outright and
// the app never hydrates. Per-request nonce lets those scripts run without 'unsafe-inline'.
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  // S05 narrowed `connect-src` back to 'self': the ElevenLabs socket allowance existed for the
  // agent dial ADR-S01 removed, and the browser now talks only to this origin (speech AC-9).
  // `media-src` has no default of its own: without it the room's question audio falls under
  // `default-src 'self'`, which does not cover the `blob:` URL `URL.createObjectURL` produces
  // for the TTS response. The element then fires `error`, which the turn loop reads as a fatal
  // voice failure and downgrades to text — voice could never play. `blob:` is same-document
  // data, not a network origin, so AC-9 ("no cross-origin connection") is untouched.
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';`;

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
