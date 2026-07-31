import { strict as assert } from 'node:assert';

import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

// User-facing modules MUST call userInterviews() or activeInterview(), never
// prisma.interview.findMany directly. Soft-delete is baked in here (K13).
//
// Admin/analytics reads that deliberately need deleted interviews (K11: "total tokens,
// deleted interviews included") bypass these helpers and say so at the call site.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ log: ['warn', 'error'] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** Non-deleted interviews for a user, newest first, paginated. */
export async function userInterviews(
  userId: string,
  opts?: { cursor?: string; limit?: number }
) {
  return prisma.interview.findMany({
    where: { user_id: userId, deleted_at: null },
    orderBy: { created_at: 'desc' },
    take: opts?.limit ?? 20,
    ...(opts?.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
}

/** Single non-deleted interview by id, or null. */
export async function activeInterview(id: string) {
  return prisma.interview.findFirst({ where: { id, deleted_at: null } });
}

/**
 * Records an LLM call and charges its cost to the interview in ONE transaction
 * (K13, §7.3). This is the db-layer contract every provider call must go through:
 * a read-outside / write-inside split lets two concurrent calls both pass a stale
 * budget check and overspend, so the increment and the `llm_calls` insert are
 * never separated. `ai` owns which model was called and what it cost; the atomicity
 * is owned here.
 *
 * Returns the committed post-charge totals. `exhausted` means the next call must not
 * happen — the caller surfaces `BUDGET_EXCEEDED` and moves the interview to
 * `evaluating` with `ended_reason = budget_exhausted` (§7.3).
 *
 * Pass `tx` to join a transaction the caller already opened. I08 reads `spent_usd` inside
 * the same transaction that writes this row; opening a second one there would put the read
 * and the write back on opposite sides of a commit, which is exactly the race above.
 */
export async function recordLlmCall(
  data: Omit<Prisma.LlmCallUncheckedCreateInput, 'id' | 'created_at'>,
  tx?: Prisma.TransactionClient
) {
  const charge = async (client: Prisma.TransactionClient) => {
    const call = await client.llmCall.create({ data });
    const interview = await client.interview.update({
      where: { id: data.interview_id },
      data: { spent_usd: { increment: data.cost_usd } },
      select: { spent_usd: true, budget_usd: true },
    });
    return {
      call,
      spent_usd: interview.spent_usd,
      budget_usd: interview.budget_usd,
      exhausted: interview.spent_usd.gte(interview.budget_usd),
    };
  };

  return tx ? charge(tx) : prisma.$transaction(charge);
}

// ---------------------------------------------------------------------------
// Self-check — `npx tsx src/lib/db.ts` against a seeded database (db spec AC-6).
// Creates a throwaway interview, soft-deletes it, asserts both helpers stop
// returning it, then removes the fixture row. Fails loudly if the soft-delete
// filter is ever dropped from either helper.
// ---------------------------------------------------------------------------

async function selfCheck() {
  const admin = await prisma.user.findUniqueOrThrow({
    where: { email_lower: 'admin@demo.com' },
  });

  const seeded = await userInterviews(admin.id);
  console.log(`userInterviews(admin) -> ${seeded.length} row(s)`);
  assert.ok(seeded.length > 0, 'seed should have produced at least one interview');
  assert.ok(
    seeded.every((i) => i.deleted_at === null),
    'userInterviews returned a soft-deleted row'
  );

  const probe = await prisma.interview.create({
    data: {
      user_id: admin.id,
      mode: 'text',
      job_text: 'self-check probe',
      job_source: 'paste',
      occupation: 'self-check',
      language: 'en',
      target_question_count: 1,
      hr_question_count: 1,
    },
  });

  assert.ok(
    (await userInterviews(admin.id)).some((i) => i.id === probe.id),
    'a live interview must appear in userInterviews'
  );
  assert.ok(await activeInterview(probe.id), 'a live interview must resolve');

  await prisma.interview.update({
    where: { id: probe.id },
    data: { deleted_at: new Date() },
  });

  assert.ok(
    !(await userInterviews(admin.id)).some((i) => i.id === probe.id),
    'a soft-deleted interview leaked into userInterviews'
  );
  assert.equal(
    await activeInterview(probe.id),
    null,
    'activeInterview must return null for a soft-deleted interview'
  );
  assert.ok(
    await prisma.interview.findUnique({ where: { id: probe.id } }),
    'soft delete must leave the row in the table'
  );

  await prisma.interview.delete({ where: { id: probe.id } });
  console.log('db.ts self-check passed.');
}

if (require.main === module) {
  selfCheck()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
