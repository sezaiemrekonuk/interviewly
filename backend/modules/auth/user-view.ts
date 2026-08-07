import type { User } from '@prisma/client';

import { prisma } from '../../src/lib/db';

// The public shape returned by register, login and /me. Never `password_hash`,
// never `google_sub`, never a token.
//
// `emailVerifiedAt`, `onboardingCompletedAt` and `interviewCount` are here so the client
// can decide the K8.7 first-run destination from one server answer instead of probing
// three endpoints to find out.
//
// `fullName` reads `profile.fullName` (card 1, `auth/profile.ts`) rather than adding a column
// — the account has exactly one name field and it already lives in the free-form JSON. Trimmed
// and `undefined` rather than `''` when unset, so the client's "has a name?" check is one
// truthiness test instead of also handling blank strings from old rows.
export async function publicUser(user: User) {
  const interviewCount = await prisma.interview.count({ where: { user_id: user.id } });
  const profile = user.profile as { fullName?: unknown } | null;
  const fullName = typeof profile?.fullName === 'string' ? profile.fullName.trim() : '';
  return {
    id: user.id,
    email: user.email_lower,
    fullName: fullName || undefined,
    role: user.role,
    locale: user.locale,
    emailVerifiedAt: user.email_verified_at,
    onboardingCompletedAt: user.onboarding_completed_at,
    interviewCount,
  };
}
