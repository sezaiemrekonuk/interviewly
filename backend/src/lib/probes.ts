/**
 * I14. `/healthz` liveness must never touch a dependency (a Postgres/Redis blip must not
 * restart-loop a live process); `/readyz` checks both, timeout-bounded so a hung dependency
 * 503s instead of hanging the probe itself.
 */
import { redis } from '../../modules/auth/rate-limit';
import { prisma } from './db';

const PING_TIMEOUT_MS = 2_000;

async function withTimeout(p: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('PING_TIMEOUT')), PING_TIMEOUT_MS);
  });

  try {
    await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Overridable pings — the acceptance seam for "Postgres/Redis is unreachable" (same shape as `setEmailQueue`). */
const defaultPingPostgres = () => withTimeout(prisma.$queryRaw`SELECT 1`);
const defaultPingRedis = () => withTimeout(redis.ping());
let pingPostgres = defaultPingPostgres;
let pingRedis = defaultPingRedis;

export function setProbeOverrides(overrides: {
  pingPostgres?: () => Promise<void>;
  pingRedis?: () => Promise<void>;
}): void {
  pingPostgres = overrides.pingPostgres ?? defaultPingPostgres;
  pingRedis = overrides.pingRedis ?? defaultPingRedis;
}

export function liveness(): { ok: true } {
  return { ok: true };
}

export async function readiness(): Promise<{ ready: boolean }> {
  try {
    await Promise.all([pingPostgres(), pingRedis()]);
    return { ready: true };
  } catch {
    return { ready: false };
  }
}
