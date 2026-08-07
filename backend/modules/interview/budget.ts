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
import type { Interview } from '@prisma/client';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

import { applyTransition } from './machine';

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

/**
 * `withBudget` plus the ending an exhausted interview needs, for every generation call site.
 *
 * All three want the same two things when the ceiling refuses: the interview ends rather than
 * sitting in a round it has no question for — the remaining turns and the report would cost too
 * — and the caller answers 402. Copying that per call site is how a ceiling grows holes: the HR
 * batch, the largest of the generations, ran outside it entirely until issue #98.
 *
 * Not for the adaptive hook (I06), which degrades to the default question instead of ending and
 * so calls `withBudget` directly.
 */
export async function withBudgetOrEnd<T>(
  interview: Interview,
  fn: () => Promise<T>,
  ctx: { traceId: string },
): Promise<T> {
  try {
    return await withBudget(interview.id, fn);
  } catch (err) {
    if (!(err instanceof BudgetExceeded)) throw err;
    logger.warn({ traceId: ctx.traceId, interviewId: interview.id }, 'BUDGET_EXHAUSTED');
    // ADR-I32: a losing transition must not replace the caller's error — the request is a 402
    // whether or not this one is the request that moved the interview.
    try {
      await applyTransition(interview, 'evaluating', {
        traceId: ctx.traceId,
        endedReason: 'budget_exhausted',
      });
    } catch (transitionErr) {
      logger.error(
        { err: transitionErr, traceId: ctx.traceId, interviewId: interview.id },
        'INTERVIEW_END_FAILED',
      );
    }
    throw new ApiError('BUDGET_EXCEEDED');
  }
}
