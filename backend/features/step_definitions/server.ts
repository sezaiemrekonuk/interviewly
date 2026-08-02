// I03 is the first task to drive the app over real HTTP instead of faking a seam directly.
// One server for the whole cucumber run (BeforeAll/AfterAll), ephemeral port so parallel
// local runs never collide. `serverState` is a mutable object, not a `let` export, so its
// value stays live across the tsx/cjs interop boundary.
import type { Server } from 'node:http';

import { AfterAll, Before, BeforeAll } from '@cucumber/cucumber';

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

// Both `redis` (ioredis, module-level, eager-connects on import) and `prisma` stay open for
// the whole run. Without closing them here the event loop never drains and cucumber-js hangs
// after printing its summary instead of exiting — a false "stuck" run, not a failing one.
AfterAll(async function stopServer() {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await Promise.all([prisma.$disconnect(), redis.quit()]);
});
