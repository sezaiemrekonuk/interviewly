import { vi, type Mock } from 'vitest';

/** A JSON `Response`, built the way `apiGet`/`apiPost` expect to read one. */
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const CAPABILITIES = '/api/auth/capabilities';
const ME = '/api/me';
const BACKGROUND = new Set<string>([CAPABILITIES, ME]);

/**
 * A `fetch` stand-in that answers one canned status + body, with the two calls an auth screen
 * makes on mount for its own reasons answered separately.
 *
 * `GET /auth/capabilities` because both screens ask it (issue 60 — the Google button has to
 * know whether the deployment can serve the flow before it offers a link that would otherwise
 * paint a JSON error as the whole page). `GET /me` because these screens are wrapped in
 * `components/auth/anonymous-only.tsx`, which sends a visitor who already has a session into
 * the app; answering it with the canned login body would make every case here a signed-in one.
 * Both are routed by URL and excluded from `formCalls`, so a screen's assertions still see
 * only its own traffic.
 */
export function stubFetch(status: number, body: unknown, google = true): Mock {
  const spy = vi.fn(async (url: string | URL) => {
    const target = String(url);
    if (target === CAPABILITIES) return jsonResponse(200, { oauth: { google } });
    if (target === ME) return jsonResponse(401, { error: { code: 'UNAUTHENTICATED' } });
    return jsonResponse(status, body);
  });
  vi.stubGlobal('fetch', spy);
  return spy as unknown as Mock;
}

/** The recorded calls that were neither the capabilities nor the session probe, oldest first. */
export function formCalls(spy: Mock): [string, RequestInit | undefined][] {
  return (spy.mock.calls as unknown as [string | URL, RequestInit | undefined][])
    .filter(([url]) => !BACKGROUND.has(String(url)))
    .map(([url, init]) => [String(url), init]);
}
