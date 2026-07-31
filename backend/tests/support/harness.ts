import './setup';

import { execSync } from 'node:child_process';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { app } from '../../src/app';
import { prisma } from '../../src/lib/db';
import { redis } from '../../modules/auth/rate-limit';

let server: Server | undefined;
let baseUrl = '';

export const getBaseUrl = (): string => baseUrl;

export async function bootApp(): Promise<void> {
  // Idempotent: applies the F02 migration if the acceptance database is empty.
  execSync('npx prisma migrate deploy', { cwd: process.cwd(), stdio: 'ignore' });
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
}
