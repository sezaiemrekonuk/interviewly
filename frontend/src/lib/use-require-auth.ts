'use client';

import { useEffect, useState } from 'react';

import { usePathname, useRouter } from '../i18n/navigation';
import { apiGet } from './api';
import { signInPathFor } from './auth-redirect';

/** The `/me` payload. */
export interface SessionUser {
  id: string;
  email: string;
  /** §3.3 card 1 (`profile.fullName`). Absent, not `''`, when the card was skipped. */
  fullName?: string;
  role: string;
  locale: string;
  /** A04/K8.6 — null until the address is confirmed. ISO timestamp over the wire. */
  emailVerifiedAt: string | null;
  /** A06/K8.7 — null until onboarding's three cards are done. */
  onboardingCompletedAt: string | null;
  /** A06/K8.7 — drives the "no interviews yet" first-run branch. */
  interviewCount: number;
}

export interface RequireAuthState {
  user: SessionUser | null;
  loading: boolean;
}

/**
 * The `UNAUTHENTICATED` half of the frontend spec's error-code table, as a hook rather
 * than Next middleware.
 *
 * Middleware cannot make this decision: the session cookie is opaque and only the API can
 * say whether the row behind it is live, unexpired and unrevoked. Middleware would have to
 * either trust cookie presence — which lets a revoked session render a protected page —
 * or call the API on every navigation. Asking `/me` from the page that needs the answer
 * is both cheaper and correct.
 *
 * Protected pages call this and render nothing until `loading` is false.
 */
export function useRequireAuth(): RequireAuthState {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<RequireAuthState>({ user: null, loading: true });

  useEffect(() => {
    let active = true;

    apiGet<{ user: SessionUser }>('/me').then((result) => {
      if (!active) return;

      if (result.code === 'UNAUTHENTICATED') {
        // `replace`, not `push`: the protected URL never becomes a back-button target for
        // a visitor who was not allowed to see it.
        router.replace(signInPathFor(pathname));
        return;
      }

      setState({ user: result.data?.user ?? null, loading: false });
    });

    return () => {
      active = false;
    };
  }, [router, pathname]);

  return state;
}
