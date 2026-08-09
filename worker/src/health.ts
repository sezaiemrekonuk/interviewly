/**
 * Issue 71. The worker is the only application service with no liveness surface, so a
 * process that has silently lost Redis reports nothing at all and an orchestrator has
 * nothing to restart on. This is the smallest thing that fixes that: `node:http`, one
 * route, no Express.
 *
 * The signal has to be Redis, not the event loop. A worker whose event loop is fine and
 * whose connection is dead is the failure that actually happens (a report job is never
 * consumed and the interview sticks in `evaluating`), and a tautological 200 would report
 * it healthy forever. So `/healthz` pings the SAME connection the BullMQ workers consume
 * from — `index.ts` builds one client and shares it — and answers 503 when that ping does
 * not come back.
 *
 * The timeout is load-bearing rather than defensive: the shared client is built with
 * `maxRetriesPerRequest: null` (BullMQ requires it), so a `ping()` issued while the socket
 * is down never rejects — it queues offline and waits forever. Bounding it is the only
 * thing that turns "disconnected" into an answer. Same shape and the same reason as the
 * API's `/readyz` (`backend/src/lib/probes.ts`).
 */
import { createServer, type Server } from 'node:http';

import { logger } from './lib/logger';

const PING_TIMEOUT_MS = 2_000;

/** The only thing the probe needs from the shared client — an ioredis instance satisfies it. */
export interface Pingable {
  ping(): Promise<unknown>;
}

/** True when the shared BullMQ connection answers a PING inside the timeout. */
export async function redisHealthy(connection: Pingable): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('PING_TIMEOUT')), PING_TIMEOUT_MS);
  });

  try {
    await Promise.race([connection.ping(), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Serves `GET /healthz` and nothing else. Read-only by construction: PING is the only
 * command it issues, so probing never enqueues, consumes or acknowledges a job.
 */
export function startHealthServer(port: number, connection: Pingable): Server {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/healthz') {
      res.writeHead(404).end();
      return;
    }
    void redisHealthy(connection).then((ok) => {
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok }));
    });
  });

  // Loopback only. The port carries no auth, and compose publishes nothing for it — binding
  // it to the container's own interface keeps `docker exec`/healthcheck as the only reach.
  server.listen(port, '127.0.0.1', () => {
    logger.info({ port }, 'WORKER_HEALTH_LISTENING');
  });

  return server;
}
