import type { Metadata } from 'next';

/**
 * Issue 93: onboarding is a signed-in surface, so it is disallowed in `robots.ts` and
 * refused here as well — the half a crawler cannot choose to ignore.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
