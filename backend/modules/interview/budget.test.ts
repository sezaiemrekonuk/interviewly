/**
 * @AC-11 asserts the refusal. It cannot assert the thing that makes the refusal reliable —
 * the lock the read is taken under — because a single-threaded scenario passes either way.
 * That is what this pins: drop the lock and the check-then-call race is back, silently.
 */
import type { Interview } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../src/lib/api-error';

import { BudgetExceeded, withBudget, withBudgetOrEnd } from './budget';

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

vi.mock('../../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const applyTransition = vi.fn(async () => 'evaluating');
vi.mock('./machine', () => ({ applyTransition: (...args: unknown[]) => applyTransition(...args) }));

function reset(spent: boolean): void {
  sql.length = 0;
  exhausted.value = spent;
  applyTransition.mockClear();
  applyTransition.mockImplementation(async () => 'evaluating');
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

/**
 * Issue #98: the HR batch is the largest generation in the system and ran outside the ceiling
 * entirely. Every call site now shares this wrapper, so what it does on refusal is asserted
 * once — the interview ends, and the caller gets the 402 the room already knows how to handle.
 */
const interview = { id: 'itv_1', state: 'hr_round' } as unknown as Interview;

describe('withBudgetOrEnd', () => {
  it('ends the interview and raises 402 instead of buying the round', async () => {
    reset(true);
    const call = vi.fn();

    await expect(withBudgetOrEnd(interview, call, { traceId: 'trc_1' })).rejects.toThrow(
      new ApiError('BUDGET_EXCEEDED'),
    );
    expect(call).not.toHaveBeenCalled();
    expect(applyTransition).toHaveBeenCalledWith(
      interview,
      'evaluating',
      expect.objectContaining({ endedReason: 'budget_exhausted' }),
    );
  });

  // ADR-I32: the request is a 402 whether or not it is the one that moved the interview.
  it('still raises 402 when another request already ended the interview', async () => {
    reset(true);
    applyTransition.mockRejectedValue(new ApiError('INVALID_STATE_TRANSITION'));

    await expect(withBudgetOrEnd(interview, vi.fn(), { traceId: 'trc_1' })).rejects.toThrow(
      new ApiError('BUDGET_EXCEEDED'),
    );
  });

  it('passes the call through and ends nothing while budget remains', async () => {
    reset(false);

    await expect(withBudgetOrEnd(interview, async () => 'batch', { traceId: 'trc_1' })).resolves.toBe(
      'batch',
    );
    expect(applyTransition).not.toHaveBeenCalled();
  });
});
