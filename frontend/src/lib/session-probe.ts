'use client';

import { apiGet } from './api';

/**
 * One `/me` per landing render, shared by the two components that independently need the
 * answer: the header's sign-in link and the signed-in redirect. Both used to ask for
 * themselves, so every load of the app's most-visited page made two identical probes — two
 * 401s and two red console lines anonymously, two authenticated requests (each a Postgres
 * write, issue 131) signed in (issue 130).
 *
 * Deliberately *not* `useMe()`: React Query stays out of the anonymous landing chunk, which
 * is the reason both call sites hand-rolled this in the first place (§8.1 JS budget).
 *
 * In-flight only, and that is the important part. The promise is shared while unresolved and
 * dropped the moment it settles, so this is a request deduplicator and never a session cache
 * — a resolved value kept here would outlive a sign-out and leave the header claiming the
 * visitor is still signed in. Concurrent mounts are the whole defect; nothing else is.
 */
let inFlight: Promise<boolean> | null = null;

export function probeSignedIn(): Promise<boolean> {
  inFlight ??= apiGet<{ user: unknown }>('/me')
    // `apiGet` resolves for every outcome including transport failure, so there is no
    // rejection path to clear — but `finally` covers one appearing later regardless.
    .then((result) => result.ok)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
