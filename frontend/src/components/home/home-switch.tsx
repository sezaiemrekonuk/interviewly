'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { apiGet } from '../../lib/api';
import { DEFAULT_LANDING_PATH } from '../../lib/auth-redirect';

/**
 * `/` is the marketing page, for everyone. A signed-in visitor is sent to their briefing.
 *
 * This used to *swap* the tree: the marketing body rendered, `/me` was probed, and the whole
 * page was replaced by a signed-in home once it answered. Because the probe starts false, an
 * existing customer was shown the hero, "Create account" and "Free while in preview" on every
 * single visit to the front door before the swap landed. A redirect has the same cost to an
 * anonymous visitor — nothing, they are the branch that never fires — and does not pitch the
 * product to people who already bought it.
 *
 * Deliberately `apiGet` rather than `useMe()`: the same reason `chrome/header-nav.tsx` gives.
 * Pulling React Query into this tree spends the §8.1 JS budget on one boolean, and the landing
 * demo below it is already the page's client weight.
 */
export function HomeSwitch({ children }: { children: ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    void apiGet<{ user: unknown }>('/me').then((result) => {
      // `replace`, not `push`: pressing back from the dashboard must leave the site rather
      // than bounce through a redirect that fires again.
      if (active && result.ok) router.replace(DEFAULT_LANDING_PATH);
    });
    return () => {
      active = false;
    };
  }, [router]);

  return <>{children}</>;
}
