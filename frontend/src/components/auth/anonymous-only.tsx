'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, type ReactNode } from 'react';

import { useRouter } from '../../i18n/navigation';
import { safeReturnPath } from '../../lib/auth-redirect';
import { firstRunPath } from '../../lib/first-run';
import { probeSession } from '../../lib/session-probe';

function AnonymousRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const explicitReturnPath = searchParams.get('returnPath');

  useEffect(() => {
    let active = true;
    void probeSession().then((user) => {
      if (!active || !user) return;
      router.replace(explicitReturnPath ? safeReturnPath(explicitReturnPath) : firstRunPath(user));
    });
    return () => {
      active = false;
    };
  }, [router, explicitReturnPath]);

  return null;
}

export function AnonymousOnly({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <AnonymousRedirect />
      </Suspense>
      {children}
    </>
  );
}
