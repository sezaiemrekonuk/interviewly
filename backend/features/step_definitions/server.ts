// I03 is the first task to drive the app over real HTTP instead of faking a seam directly.
// One server for the whole cucumber run (BeforeAll/AfterAll), ephemeral port so parallel
// local runs never collide. `serverState` is a mutable object, not a `let` export, so its
// value stays live across the tsx/cjs interop boundary.
import type { Server } from 'node:http';

import { AfterAll, BeforeAll } from '@cucumber/cucumber';

import { redis } from '../../modules/auth/rate-limit';
import { app } from '../../src/app';
import { prisma } from '../../src/lib/db';

export const serverState: { baseUrl: string } = { baseUrl: '' };

let server: Server;

BeforeAll(async function startServer() {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  serverState.baseUrl = `http://127.0.0.1:${port}`;
});

// Both `redis` (ioredis, module-level, eager-connects on import) and `prisma` stay open for
// the whole run. Without closing them here the event loop never drains and cucumber-js hangs
// after printing its summary instead of exiting — a false "stuck" run, not a failing one.
AfterAll(async function stopServer() {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await Promise.all([prisma.$disconnect(), redis.quit()]);
});
