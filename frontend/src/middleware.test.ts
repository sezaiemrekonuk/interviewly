/**
 * The CSP the room plays its question audio under. `media-src` has no default of its own — it
 * falls back to `default-src 'self'`, which does not cover `blob:`, and the turn loop hands
 * `new Audio()` exactly one of those (`URL.createObjectURL` on the TTS response). Blocked media
 * fires `error` on the element, which the hook treats as a fatal voice failure and downgrades
 * the interview to text — so a missing directive here is a room where voice can never work.
 */
import { describe, expect, it } from 'vitest';

import { middleware } from './middleware';

function csp(): string {
  const request = new Request('http://localhost/interviews/i1/room');
  const response = middleware(request as never);
  return response.headers.get('Content-Security-Policy') ?? '';
}

describe('the room CSP', () => {
  it('lets the question audio play from a blob URL', () => {
    expect(csp()).toContain("media-src 'self' blob:");
  });

  // speech AC-9: no cross-origin connection from the built room. `blob:` above is same-document
  // data, not an origin, so it does not widen this.
  it('still allows no network origin but this one', () => {
    expect(csp()).toContain("connect-src 'self'");
    expect(csp()).toContain("default-src 'self'");
    expect(csp()).toContain("frame-ancestors 'none'");
  });
});
