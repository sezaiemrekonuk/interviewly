import { vi, type Mock } from 'vitest';

/** A JSON `Response`, built the way `apiGet`/`apiPost` expect to read one. */
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const CAPABILITIES = '/api/auth/capabilities';

/**
 * A `fetch` stand-in that answers one canned status + body, with `GET /auth/capabilities`
 * answered separately.
 *
 * Both auth screens ask that endpoint on mount now (issue 60 — the Google button has to know
 * whether the deployment can serve the flow before it offers a link that would otherwise
 * paint a JSON error as the whole page). Folding it into the canned answer would put a
 * capabilities call where a screen's assertions expect its own, so it is routed by URL and
 * excluded from `formCalls`.
 */
export function stubFetch(status: number, body: unknown, google = true): Mock {
  const spy = vi.fn(async (url: string | URL) =>
    String(url) === CAPABILITIES
      ? jsonResponse(200, { oauth: { google } })
      : jsonResponse(status, body),
  );
  vi.stubGlobal('fetch', spy);
  return spy as unknown as Mock;
}

/** The recorded calls that were not the capabilities probe, oldest first. */
export function formCalls(spy: Mock): [string, RequestInit | undefined][] {
  return (spy.mock.calls as unknown as [string | URL, RequestInit | undefined][])
    .filter(([url]) => String(url) !== CAPABILITIES)
    .map(([url, init]) => [String(url), init]);
}
