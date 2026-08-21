/**
 * Read-replica routing for the admin console only (`backend/modules/admin/*`). Everything
 * else — the interview flow, the candidate-facing report view, every write anywhere — keeps
 * using `prisma` from `./db` directly and is untouched by this file.
 *
 * `DATABASE_REPLICA_URL` is optional (`compose.replica.yaml`, opt-in). Unset means there is no
 * replica to route to, so `adminRead` just runs the callback against the primary and says so.
 */
import { PrismaClient } from '@prisma/client';
import type { Response } from 'express';

import { config } from './env';
import { prisma } from './db';
import { logger } from './logger';

const replicaPrisma = config.DATABASE_REPLICA_URL
  ? new PrismaClient({ datasources: { db: { url: config.DATABASE_REPLICA_URL } } })
  : null;

export type ReadSource = 'primary' | 'replica';

export interface AdminReadResult<T> {
  data: T;
  source: ReadSource;
  /** Seconds behind the primary's last replayed transaction, or null when unmeasured. */
  lagSeconds: number | null;
}

// ponytail: sampled once per LAG_CACHE_MS rather than once per request. A lag figure a couple
// of seconds stale is still an honest "how far behind is this read", and querying it inline on
// every admin request would add a round trip to the replica just to report on itself. Upgrade
// to a background poller if a request-accurate figure ever matters.
const LAG_CACHE_MS = 2_000;
let lagCache: { value: number | null; at: number } | null = null;

async function replicaLagSeconds(): Promise<number | null> {
  if (!replicaPrisma) return null;
  if (lagCache && Date.now() - lagCache.at < LAG_CACHE_MS) return lagCache.value;

  const rows = await replicaPrisma.$queryRaw<{ lag_seconds: number | null }[]>`
    SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::float8 AS lag_seconds
  `;
  const value = rows[0]?.lag_seconds ?? null;
  lagCache = { value, at: Date.now() };
  return value;
}

/**
 * Runs a read-only callback against the replica when one is configured, falling back to the
 * primary on any replica failure (connection down, query error, lag probe failure) — a warning
 * is logged, the caller gets the same data it would have gotten anyway. Never call this with
 * anything that writes: the replica is a streaming standby and a write against it fails, but
 * failing shouldn't be how that gets caught.
 */
export async function adminRead<T>(
  fn: (client: PrismaClient) => Promise<T>,
): Promise<AdminReadResult<T>> {
  if (!replicaPrisma) {
    return { data: await fn(prisma), source: 'primary', lagSeconds: null };
  }

  try {
    const [data, lagSeconds] = await Promise.all([fn(replicaPrisma), replicaLagSeconds()]);
    return { data, source: 'replica', lagSeconds };
  } catch (err) {
    logger.warn({ err }, 'ADMIN_REPLICA_READ_FAILED');
    return { data: await fn(prisma), source: 'primary', lagSeconds: null };
  }
}

/**
 * The staleness contract every admin handler owes its caller (invariant: never serve a
 * replica-sourced figure without a way to tell). `X-Replica-Lag-Seconds` is only set when the
 * read actually came from the replica and a lag figure was obtained — a primary read has no
 * lag to report, and a replica read whose lag probe itself failed says so by omission rather
 * than by printing a number it doesn't have.
 */
export function applyReadHeaders(res: Response, result: AdminReadResult<unknown>): void {
  res.set('X-Read-Source', result.source);
  if (result.lagSeconds !== null) {
    res.set('X-Replica-Lag-Seconds', result.lagSeconds.toFixed(3));
  }
}

