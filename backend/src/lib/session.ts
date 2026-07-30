import { randomBytes } from 'node:crypto';

import type { Response } from 'express';

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
