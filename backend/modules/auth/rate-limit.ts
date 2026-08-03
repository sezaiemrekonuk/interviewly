import type { RequestHandler } from 'express';
import { Redis } from 'ioredis';

import { config } from '../../src/lib/env';
import { logger } from '../../src/lib/logger';

// One shared Redis connection for the whole auth module. A02 reuses this client for
// PKCE state storage — do not open a second connection.
export const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

// Sliding-window counter over a sorted set keyed by IP. Returns the count inside the
// window after recording this hit; the caller rejects when it exceeds the limit.
async function slidingWindowHit(key: string, windowMs: number): Promise<number> {
  const now = Date.now();
  const member = `${now}-${Math.random()}`;
  const results = await redis
    .multi()
    .zremrangebyscore(key, 0, now - windowMs)
    .zadd(key, now, member)
    .zcard(key)
    .pexpire(key, windowMs)
    .exec();
  // exec() → array of [err, value] tuples; zcard is the third command.
  const count = results?.[2]?.[1];
  return typeof count === 'number' ? count : 0;
}

function limiter(prefix: string, limit: number, windowMs: number): RequestHandler {
  return (req, res, next) => {
    const ip = req.ip ?? 'unknown';
    void slidingWindowHit(`ratelimit:${prefix}:${ip}`, windowMs)
      .then((count) => {
        if (count > limit) {
          logger.warn({ ip, traceId: req.traceId }, 'RATE_LIMIT_HIT');
          res.status(429).json({ error: { code: 'RATE_LIMITED' } });
          return;
        }
        next();
      })
      .catch(next);
  };
}

// K8 / REFERENCE: register 3/hour per IP, login 5/minute per IP.
export const registerLimiter = limiter('register', 3, 60 * 60 * 1000);
export const loginLimiter = limiter('login', 5, 60 * 1000);
// A05: 5/hour per IP. Keyed by IP like the two above and unlike the resend limits below —
// a per-account key would answer 429 only for addresses that have an account, which is the
// enumeration leak the endpoint's identical 202 exists to prevent.
export const passwordResetLimiter = limiter('passwordreset', 5, 60 * 60 * 1000);

// --------------------------------------------------------------------- A04: mail resends
//
// Both of these are keyed by USER, not by IP — unlike register and login above. The
// resend endpoint is authenticated, so the account is the thing worth protecting, and an
// IP key would let one abusive account exhaust a shared office NAT's budget for everyone.

export const RESEND_COOLDOWN_SECONDS = 60;
const RESEND_LIMIT_PER_HOUR = 5;

export interface CooldownResult {
  ok: boolean;
  /** Seconds still to wait. `0` when the cooldown was claimed. */
  remainingSeconds: number;
}

/**
 * Claims the 60-second cooldown for a user, atomically. `SET NX` is the claim: whoever
 * sets the key owns the window, and everyone else reads its remaining TTL. A read-then-set
 * pair would let two resends in the same tick both see an empty key and both send.
 */
export async function claimResendCooldown(userId: string): Promise<CooldownResult> {
  const key = `emailresend:cooldown:${userId}`;
  const claimed = await redis.set(key, '1', 'EX', RESEND_COOLDOWN_SECONDS, 'NX');
  if (claimed) return { ok: true, remainingSeconds: RESEND_COOLDOWN_SECONDS };

  const ttl = await redis.ttl(key);
  // A key with no TTL (-1) or already gone (-2) is not something to make the caller wait
  // on; treat it as one second so the client's countdown is never negative.
  return { ok: false, remainingSeconds: ttl > 0 ? ttl : 1 };
}

/** Records one resend against the hourly budget. True while the user is still inside it. */
export async function withinResendQuota(userId: string): Promise<boolean> {
  const count = await slidingWindowHit(
    `ratelimit:emailresend:${userId}`,
    60 * 60 * 1000,
  );
  return count <= RESEND_LIMIT_PER_HOUR;
}
