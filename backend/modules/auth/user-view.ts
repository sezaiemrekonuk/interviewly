import type { User } from '@prisma/client';

// The public shape returned by register, login and /me. Never `password_hash`,
// never `google_sub`, never a token.
export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email_lower,
    role: user.role,
    locale: user.locale,
  };
}
