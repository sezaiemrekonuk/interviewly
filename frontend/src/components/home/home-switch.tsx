'use client';

import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';

import { apiGet } from '../../lib/api';

// Imported only once `/me` says 200: React Query, the list and its CSS stay out of the
// anonymous landing's chunk (§8.1 JS budget, guarded by `app/page.test.tsx`).
const AuthedHome = lazy(() => import('./authed-home').then((m) => ({ default: m.AuthedHome })));

/**
 * `/` is two screens. Which one the visitor gets is a session fact only the API knows, so
 * the marketing page renders first and is replaced when the probe resolves — an anonymous
 * visitor, the common case, never waits on a request and never sees a skeleton.
 *
 * Deliberately `apiGet`, not `useMe()`: the same reason `chrome/header-nav.tsx` gives —
 * pulling the query client into this tree spends the budget on one boolean.
 */
export function HomeSwitch({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;
    void apiGet<{ user: unknown }>('/me').then((result) => {
      if (active) setSignedIn(result.ok);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!signedIn) return <>{children}</>;

  // No fallback markup: the chunk resolves in the same tick the state flips in practice,
  // and a skeleton that flashes for one frame is worse than nothing.
  return (
    <Suspense fallback={null}>
      <AuthedHome />
    </Suspense>
  );
}
