/**
 * The terminal case of the K8.7 first-run rule (`lib/first-run.ts`): onboarding done and
 * at least one interview exists. Also the fallback when a `?returnPath=` is unusable.
 *
 * `/dashboard` is the signed-in home. It used to be `/`, which served both audiences and
 * flashed the marketing page at signed-in visitors; the two are now separate surfaces and
 * `/` redirects here for anyone with a session (`components/home/home-switch.tsx`).
 */
export const DEFAULT_LANDING_PATH = '/dashboard';

/**
 * Narrows a `?returnPath=` query value to a same-origin path.
 *
 * `startsWith('/')` on its own is not enough: `//evil.example/x` also starts with a slash
 * and the browser reads it as a protocol-relative URL, which is an open redirect. A
 * backslash after the first slash is the same trick against normalising parsers.
 */
export function safeReturnPath(candidate: string | null | undefined): string {
  if (!candidate) return DEFAULT_LANDING_PATH;
  if (!candidate.startsWith('/')) return DEFAULT_LANDING_PATH;
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return DEFAULT_LANDING_PATH;
  return candidate;
}

/** The path an unauthenticated visitor is sent to, preserving where they were headed. */
export function signInPathFor(pathname: string): string {
  return `/sign-in?returnPath=${encodeURIComponent(pathname)}`;
}
