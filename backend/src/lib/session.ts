import { randomBytes } from 'node:crypto';

import type { User } from '@prisma/client';
import type { Response } from 'express';

import { ApiError } from './api-error';
import { prisma } from './db';
import { config } from './env';

// The session cookie holds the opaque token, which is also the `sessions.id` row key.
// 32 random bytes → 64-char hex. Never logged.
export const SESSION_COOKIE = 'session';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function sessionExpiry(): Date {
  return new Date(Date.now() + SEVEN_DAYS_MS);
}

export function issueCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SEVEN_DAYS_MS });
}

export function revokeCookie(res: Response): void {
  res.cookie(SESSION_COOKIE, '', { ...cookieOptions(), maxAge: 0 });
}

/** How the caller proved the identity. Google is the only non-password source today. */
export type SessionSource = 'password' | 'google';

// The single place a session row is created, so the K8 admin restriction cannot be
// bypassed by a future code path. This is the *second* of the two required checks —
// the first lives in the Google callback, before we get anywhere near this function.
export async function issueSessionForUser(
  user: User,
  res: Response,
  source: SessionSource,
): Promise<void> {
  if (source === 'google' && user.role === 'admin') {
    throw new ApiError('ADMIN_MUST_USE_PASSWORD');
  }
  const token = generateToken();
  await prisma.session.create({
    data: { id: token, user_id: user.id, expires_at: sessionExpiry() },
  });
  issueCookie(res, token);
}
