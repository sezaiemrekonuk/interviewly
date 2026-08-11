// I03 is the first task to drive the app over real HTTP instead of faking a seam directly.
// One server for the whole cucumber run (BeforeAll/AfterAll), ephemeral port so parallel
// local runs never collide. `serverState` is a mutable object, not a `let` export, so its
// value stays live across the tsx/cjs interop boundary.
import { execSync } from 'node:child_process';
import type { Server } from 'node:http';
import { join } from 'node:path';

import { AfterAll, Before, BeforeAll } from '@cucumber/cucumber';

import { setEmailQueue } from '../../modules/auth/mail-queue';
import { redis } from '../../modules/auth/rate-limit';
import { app } from '../../src/app';
import { prisma } from '../../src/lib/db';
import { setProbeOverrides } from '../../src/lib/probes';
import { reportQueue } from '../../src/lib/queue';
import { assertDisposableStores } from '../fixtures/disposable-stores';

export const serverState: { baseUrl: string } = { baseUrl: '' };

// Anchored to this file, not to `process.cwd()`, for the reason `tests/support/harness.ts`
// gives: the runner is invoked from the repo root and a cwd-relative path stops resolving the
// moment it is not.
const SCHEMA = join(__dirname, '../../prisma/schema.prisma');

let server: Server;

BeforeAll(async function startServer() {
  // Issues #170 and #119. This ring creates interviews and enqueues report jobs, and until now
  // it had no equivalent of the auth ring's database check — so it was the one that stranded 26
  // fixture interviews in the application's `evaluating`. Checked before the server listens, so
  // a misconfigured run dies here rather than after its first write.
  assertDisposableStores();
  // Safe only because the line above proved this is not db 0. A run inherits nothing from the
  // last one: the per-scenario `Before` below drops rate-limit keys, but BullMQ job state and
  // anything a crashed run left behind outlive it.
  await redis.flushdb();
  // Idempotent, and new with #170: this ring used to inherit the application's database, which
  // is migrated by the compose `migrate` service. Its own is not — a developer who has never
  // run the auth profile has an empty `interviewly_test` — and "relation does not exist" on the
  // first scenario is a poor way to learn that. Mirrors `tests/support/harness.ts`; CI migrates
  // the same database a step earlier, where this is a no-op.
  execSync(`npx prisma migrate deploy --schema "${SCHEMA}"`, { stdio: 'ignore' });
  // A04's injection seam, same as the auth ring's mail recorder: scenarios here register
  // users, and without this the first registration constructs the real BullMQ queue, whose
  // Redis connection has no owner to close it — the run then hangs after its summary
  // exactly like the eager clients the AfterAll below exists for. Mail is not this ring's
  // subject, so the jobs are dropped rather than recorded.
  setEmailQueue({ add: async () => {} });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  serverState.baseUrl = `http://127.0.0.1:${port}`;
});

/**
 * Two pieces of shared state a scenario must not inherit from its neighbours.
 *
 * **Rate-limit counters.** Registration is 3/hour per IP (A01) and every scenario in the
 * suite arrives from 127.0.0.1, so the fourth scenario to sign someone in would 429 for
 * reasons that have nothing to do with what it is testing. `rate_limits.feature` (I13) is
 * where the limiter is the subject; everywhere else it is noise, and it is reset here.
 *
 * **Personas.** `personas` is seeded reference data (F02), but CI runs `prisma migrate
 * deploy` without `npm run seed` — the seed PUTs avatar objects and needs a bucket CI does
 * not start. Round creation needs a `persona_id`, so the two rows the interview flow reads
 * are upserted on deterministic ids: idempotent against a machine that *has* been seeded.
 */
Before(async function resetSharedState() {
  setProbeOverrides({});
  const keys = await redis.keys('ratelimit:*');
  if (keys.length > 0) await redis.del(...keys);

  for (const [role, name] of [
    ['hr', 'Ada'],
    ['tech', 'Turing'],
  ]) {
    await prisma.persona.upsert({
      where: { id: `seed-persona-${role}` },
      update: {},
      create: {
        id: `seed-persona-${role}`,
        role,
        name,
        voice_id: `acceptance-voice-${role}`,
        avatar_set: {},
        system_prompt: `Acceptance ${role} persona.`,
        active: true,
      },
    });
  }
});

// `redis` (ioredis, module-level, eager-connects on import), `prisma` and — since R01 —
// `reportQueue` (BullMQ, its own connection, constructed at import of src/lib/queue.ts) all
// stay open for the whole run. Without closing them here the event loop never drains and
// cucumber-js hangs after printing its summary instead of exiting — a false "stuck" run, not
// a failing one. This is the same trap the `setEmailQueue` seam above exists for; the report
// queue cannot take that route because AC-20 asserts on the real job.
AfterAll(async function stopServer() {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await Promise.all([
    prisma.$disconnect(),
    redis.quit(),
    reportQueue.close(),
  ]);
});
