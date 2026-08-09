import { randomBytes } from 'node:crypto';

import type { User } from '@prisma/client';
import type { Response } from 'express';

import { ApiError } from './api-error';
import { prisma } from './db';
import { config } from './env';

// The session cookie holds the opaque token, which is also the `sessions.id` row key.
// 32 random bytes → 64-char hex. Never logged.
export const SESSION_COOKIE = 'session';

const sessionTtlMs = config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
if (sessionTtlMs <= 0) {
  throw new Error('SESSION_TTL_DAYS must be > 0');
}

/**
 * How far behind the stored expiry has to fall before `requireAuth` slides it. Sliding on
 * every request cost a write per `GET /me`, per room poll and per SSE connect, to move an
 * expiry by milliseconds (issue #131).
 *
 * An hour, but never more than a twenty-fourth of the lifetime: with a short `SESSION_TTL_DAYS`
 * a fixed hour would be most of the window, so an active session could reach its own expiry
 * before earning a slide.
 */
export const SESSION_SLIDE_THRESHOLD_MS = Math.max(
  1,
  Math.min(60 * 60 * 1000, sessionTtlMs / 24),
);

function cookieOptions() {
  return {
    httpOnly: true,
    // The setting, not `NODE_ENV` (issue #69). `NODE_ENV` is a build concern; whether the
    // cookie may travel in clear is a transport one, and the two come apart on exactly the
    // deployment that matters — a TLS staging box whose container inherited
    // `NODE_ENV=development` was sending this cookie without `Secure`.
    secure: config.SESSION_COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: '/',
  };
}

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function sessionExpiry(): Date {
  return new Date(Date.now() + sessionTtlMs);
}

export function issueCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: sessionTtlMs });
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
