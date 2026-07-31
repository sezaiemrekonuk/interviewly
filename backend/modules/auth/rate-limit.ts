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
