// I03 is the first task to drive the app over real HTTP instead of faking a seam directly.
// One server for the whole cucumber run (BeforeAll/AfterAll), ephemeral port so parallel
// local runs never collide. `serverState` is a mutable object, not a `let` export, so its
// value stays live across the tsx/cjs interop boundary.
import type { Server } from 'node:http';

import { AfterAll, Before, BeforeAll } from '@cucumber/cucumber';

import { setEmailQueue } from '../../modules/auth/mail-queue';
import { redis } from '../../modules/auth/rate-limit';
import { app } from '../../src/app';
import { prisma } from '../../src/lib/db';
import { setProbeOverrides } from '../../src/lib/probes';
import { reportQueue, voiceReconcileQueue } from '../../src/lib/queue';

export const serverState: { baseUrl: string } = { baseUrl: '' };

let server: Server;

BeforeAll(async function startServer() {
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
// `reportQueue` — and since V04 `voiceReconcileQueue` — (BullMQ, their own connections,
// constructed at import of src/lib/queue.ts) all
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
    voiceReconcileQueue.close(),
  ]);
});
