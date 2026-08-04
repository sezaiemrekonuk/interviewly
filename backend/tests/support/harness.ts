import './setup';

import { execSync } from 'node:child_process';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { app } from '../../src/app';
import { prisma } from '../../src/lib/db';
import { reportQueue, voiceReconcileQueue } from '../../src/lib/queue';
import { redis } from '../../modules/auth/rate-limit';

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
// The rule is by database NAME, because that is the part a human reads before pasting a URL.
// CI's database is literally `ci`; local acceptance uses `interviewly_test` (db/init.sql
// creates it). Anything else must opt in out loud.
function assertDisposableDatabase(): void {
  if (process.env.ACCEPTANCE_ALLOW_DESTRUCTIVE_DB === '1') return;
  const url = process.env.DATABASE_URL ?? '';
  const name = url.split('?')[0].split('/').pop() ?? '';
  if (/(^|[_-])(test|ci)$/.test(name)) return;
  throw new Error(
    `Refusing to run acceptance against database "${name}": this suite TRUNCATEs users, ` +
      `sessions and email_tokens between scenarios. Point DATABASE_URL at a database whose ` +
      `name ends in _test or ci (db/init.sql creates interviewly_test), or set ` +
      `ACCEPTANCE_ALLOW_DESTRUCTIVE_DB=1 if you meant it.`,
  );
}

export async function bootApp(): Promise<void> {
  assertDisposableDatabase();
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
  // V04 added a second queue to that module — every queue there needs a close here.
  await Promise.all([reportQueue.close(), voiceReconcileQueue.close()]);
}
