import type { User } from '@prisma/client';

// The public shape returned by register, login and /me. Never `password_hash`,
// never `google_sub`, never a token.
//
// `emailVerifiedAt` is here so the client can render the verification prompt from one
// server answer (K8.6/K8.7) instead of probing an endpoint to find out. A06 adds
// `onboardingCompletedAt` and `interviewCount` to complete the first-run shape.
export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email_lower,
    role: user.role,
    locale: user.locale,
    emailVerifiedAt: user.email_verified_at,
  };
}
