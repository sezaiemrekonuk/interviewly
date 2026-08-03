/**
 * @AC-11 asserts the refusal. It cannot assert the thing that makes the refusal reliable —
 * the lock the read is taken under — because a single-threaded scenario passes either way.
 * That is what this pins: drop the lock and the check-then-call race is back, silently.
 */
import { describe, expect, it, vi } from 'vitest';

const sql: string[] = [];
const exhausted = { value: false };

const tx = {
  $executeRaw: vi.fn(async (parts: TemplateStringsArray) => {
    sql.push(parts.join('?'));
    return 1;
  }),
  $queryRaw: vi.fn(async (parts: TemplateStringsArray) => {
    sql.push(parts.join('?'));
    return [{ exhausted: exhausted.value }];
  }),
};

vi.mock('../../src/lib/db', () => ({
  prisma: { $transaction: (run: (client: unknown) => Promise<unknown>) => run(tx) },
}));

const { BudgetExceeded, withBudget } = await import('./budget');

function reset(spent: boolean): void {
  sql.length = 0;
  exhausted.value = spent;
}

describe('withBudget', () => {
  it('makes no call once the budget is spent', async () => {
    reset(true);
    const call = vi.fn();
    await expect(withBudget('itv_1', call)).rejects.toBeInstanceOf(BudgetExceeded);
    expect(call).not.toHaveBeenCalled();
  });

  it('takes the interview lock before reading the ceiling', async () => {
    reset(false);
    const order: string[] = [];
    await withBudget('itv_1', async () => order.push('called'));

    expect(sql[0]).toContain('pg_advisory_xact_lock');
    expect(sql[1]).toContain('spent_usd >= budget_usd');
    expect(order).toEqual(['called']);
  });
});
