import type { User } from '@prisma/client';

import { prisma } from '../../src/lib/db';

// The public shape returned by register, login and /me. Never `password_hash`,
// never `google_sub`, never a token.
//
// `emailVerifiedAt`, `onboardingCompletedAt` and `interviewCount` are here so the client
// can decide the K8.7 first-run destination from one server answer instead of probing
// three endpoints to find out.
export async function publicUser(user: User) {
  const interviewCount = await prisma.interview.count({ where: { user_id: user.id } });
  return {
    id: user.id,
    email: user.email_lower,
    role: user.role,
    locale: user.locale,
    emailVerifiedAt: user.email_verified_at,
    onboardingCompletedAt: user.onboarding_completed_at,
    interviewCount,
  };
}
