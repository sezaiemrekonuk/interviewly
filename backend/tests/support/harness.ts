import './setup';

import { execSync } from 'node:child_process';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { app } from '../../src/app';
import { prisma } from '../../src/lib/db';
import { reportQueue } from '../../src/lib/queue';
import { redis } from '../../modules/auth/rate-limit';
import { assertDisposableStores } from '../../features/fixtures/disposable-stores';

let server: Server | undefined;
let baseUrl = '';

export const getBaseUrl = (): string => baseUrl;

// Anchored to this file, not to `process.cwd()`: the runner moved to the repo root when
// the auth ring was rewired into the root `cucumber.js`, and a cwd-relative schema path
// silently stops resolving the moment the run is invoked from anywhere else.
const SCHEMA = join(__dirname, '../../prisma/schema.prisma');

// `resetState` below TRUNCATEs unconditionally, so an acceptance run inherits whatever
// DATABASE_URL happens to be exported and empties it. That is not hypothetical: a run against
// the compose `interviewly` database took the seeded demo admin with it and left the table
// holding nothing but the suite's own fixtures. Checked once, at boot, so the run dies before
// it destroys anything rather than after the first scenario.
//
// The rule itself moved to `features/fixtures/disposable-stores.ts` (issues #170, #119): it
// lived here, where only this ring could see it, while the `default` ring wrote fixtures into
// the application's database unchecked. One rule, both rings, or it is not a guard.
export async function bootApp(): Promise<void> {
  assertDisposableStores();
  // Safe only because the line above proved this is not Redis db 0. See the same call in
  // `features/step_definitions/server.ts`.
  await redis.flushdb();
  // Idempotent: applies the F02 migration if the acceptance database is empty.
  execSync(`npx prisma migrate deploy --schema "${SCHEMA}"`, { stdio: 'ignore' });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server!.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

// Between scenarios: empty the auth tables and drop only the rate-limit keys.
export async function resetState(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE sessions, email_tokens, users RESTART IDENTITY CASCADE',
  );
  const keys = await redis.keys('ratelimit:*');
  if (keys.length) await redis.del(...keys);
}

export async function stopApp(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  await prisma.$disconnect();
  redis.disconnect();
  // R01: `app` mounts the interview router, which pulls in `src/lib/queue.ts` and its eager
  // BullMQ connection. Unclosed it holds the event loop open and the ring hangs after the
  // summary. This ring never enqueues a report; it only has to let go of the connection.
  await reportQueue.close();
}
