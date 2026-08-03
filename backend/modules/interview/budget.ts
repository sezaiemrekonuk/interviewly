/**
 * The per-interview cost ceiling (§7.3, ADR-I08, K13).
 *
 * The race the ceiling has to close is check-then-call: two calls that both read the same
 * total both pass, and the interview is billed twice over. Closing it needs mutual exclusion
 * held across the provider call, not merely a read on the right side of a commit — so the
 * gate takes a transaction-scoped **advisory** lock keyed by the interview, reads the total
 * under it, and only then calls. The second caller waits, reads the charged total, is refused.
 *
 * ADR-I33 explains why the lock is advisory rather than `SELECT … FOR UPDATE` on the
 * interview row, and why the charge commits on its own connection instead of inside this
 * transaction.
 */
import { prisma } from '../../src/lib/db';

export class BudgetExceeded extends Error {
  constructor() {
    super('interview budget exhausted');
    this.name = 'BudgetExceeded';
  }
}

// ponytail: the lock is held for the whole provider call, so one interview's generations
// serialise and a stuck provider parks it for up to this long. Raise it the day a call
// legitimately takes longer; a shorter-lived reservation would need the cost up front, which
// no provider gives us.
const TX_TIMEOUT_MS = 45_000;

// Advisory-lock namespace. Any other advisory lock in this codebase picks a different one; a
// collision inside this namespace only ever over-serialises two interviews, never under-locks.
const BUDGET_LOCK_NS = 8_108;

/**
 * Runs `fn` — an AI call — under the ceiling, and throws `BudgetExceeded` *without* calling
 * it when the interview has already spent its budget.
 */
export async function withBudget<T>(interviewId: string, fn: () => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      // `::int` because a bound JS number arrives as bigint, and the two-key overload is
      // (int, int) — the (bigint) overload is the one-key form.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BUDGET_LOCK_NS}::int, hashtext(${interviewId}))`;

      // Compared in SQL so no Decimal crosses the raw-query boundary. Read under the lock, so
      // it sees whatever the previous holder committed.
      const rows = await tx.$queryRaw<{ exhausted: boolean }[]>`
        SELECT spent_usd >= budget_usd AS exhausted FROM interviews WHERE id = ${interviewId}
      `;
      if (rows.length === 0) throw new Error(`no interview ${interviewId} to charge`);
      if (rows[0].exhausted) throw new BudgetExceeded();

      return fn();
    },
    { maxWait: TX_TIMEOUT_MS, timeout: TX_TIMEOUT_MS },
  );
}
