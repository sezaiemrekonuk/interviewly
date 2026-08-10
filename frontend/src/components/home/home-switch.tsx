'use client';

import { useEffect, type ReactNode } from 'react';

import { useRouter } from '../../i18n/navigation';
import { firstRunPath } from '../../lib/first-run';
import { probeSession } from '../../lib/session-probe';

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
 * Deliberately a bare probe rather than `useMe()`: the same reason `chrome/header-nav.tsx`
 * gives. Pulling React Query into this tree spends the §8.1 JS budget on one boolean, and the
 * landing demo below it is already the page's client weight. The probe itself is shared with
 * the header, which mounts beside this in the same tree (`lib/session-probe.ts`, issue 130).
 */
export function HomeSwitch({ children }: { children: ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    void probeSession().then((user) => {
      // `replace`, not `push`: pressing back from the destination must leave the site rather
      // than bounce through a redirect that fires again.
      //
      // `firstRunPath`, not a constant: this is the same K8.7 rule the password sign-in
      // applies, so a signed-in visitor who never finished onboarding is sent there instead
      // of to a signed-in home they cannot use yet. Sending every session to one landing
      // path is what let Google users skip onboarding entirely (issue 80).
      if (active && user) router.replace(firstRunPath(user));
    });
    return () => {
      active = false;
    };
  }, [router]);

  return <>{children}</>;
}
