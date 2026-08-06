/**
 * Two orderings in `advanceWithAnswer` that no assertion about the finished row can see.
 *
 * 1. I10 runs before the K4 hook, and the hook reads `interview.language` off it. That is the
 *    whole of issue #148's fifth criterion: the candidate pool is written *after* a language
 *    switch lands, so it is never in the old language and never needs the refresh pass
 *    `language.ts` used to carry. Swap the two statements and the pool goes out stale, with
 *    every row still looking correct.
 *
 * 2. The hook is inside I08's ceiling. It spends on every turn now, so an interview that has
 *    exhausted its budget must stop paying for adaptivity — but not stop, because the turn is
 *    already stored and the default next question is askable.
 */
import type { Interview } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];

vi.mock('../../src/lib/db', () => ({
  prisma: {
    interview: { updateMany: vi.fn(async () => ({ count: 1 })) },
    // The turn's two writes are built eagerly into the `$transaction` array, so both
    // delegates have to exist even though the array itself is not what is under test.
    answer: { create: vi.fn(async () => ({ id: 'ans_1' })) },
    chatMessage: { create: vi.fn(async () => ({})) },
    $transaction: async () => [{ id: 'ans_1' }, {}],
  },
}));

const warn = vi.fn();
vi.mock('../../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: (...args: unknown[]) => warn(...args), error: vi.fn() },
}));

vi.mock('./state', () => ({
  currentQuestionRow: vi.fn(async () => ({
    id: 'qst_1',
    text: 'Bir indeksi nasıl seçersin?',
    difficulty: 'medium',
    topic: 'sql-indexes',
    asked_at: new Date('2026-08-06T10:00:00Z'),
  })),
}));

vi.mock('./generation', () => ({ ensureTechBatch: vi.fn(async () => undefined) }));
vi.mock('./machine', () => ({ applyTransition: vi.fn(async () => 'hr_round') }));

/** The switch this turn completes: I10 returns the new language, `advanceWithAnswer` adopts it. */
vi.mock('./language', () => ({
  trackLanguage: vi.fn(async () => {
    calls.push('trackLanguage');
    return 'tr';
  }),
}));

/** Captured at hook time, not after — the point is what the hook was handed. */
let languageSeenByHook: string | undefined;
const promoteNextQuestion = vi.fn(async (interview: Interview) => {
  calls.push('promoteNextQuestion');
  languageSeenByHook = interview.language;
});
vi.mock('./adaptive', () => ({ promoteNextQuestion: (i: Interview) => promoteNextQuestion(i) }));

class BudgetExceeded extends Error {}
const budgetSpent = { value: false };
vi.mock('./budget', () => ({
  BudgetExceeded,
  withBudget: async (_id: string, fn: () => Promise<unknown>) => {
    calls.push('withBudget');
    if (budgetSpent.value) throw new BudgetExceeded();
    return fn();
  },
}));

const { advanceWithAnswer } = await import('./answers');

// Parked in the technical round: no ADR-I22 batch and no handover fire on this turn, so the
// only ceiling the submit reaches is the hook's and `calls` holds one `withBudget`.
const interview = () =>
  ({
    id: 'itv_1',
    state: 'tech_round',
    current_index: 3,
    hr_question_count: 4,
    target_question_count: 8,
    language: 'en',
  }) as unknown as Interview;

beforeEach(() => {
  calls.length = 0;
  languageSeenByHook = undefined;
  budgetSpent.value = false;
  promoteNextQuestion.mockClear();
  warn.mockClear();
});

function submit() {
  return advanceWithAnswer(
    interview(),
    { questionId: 'qst_1', transcript: 'Bir cevap.', inputMode: 'text' },
    { traceId: 'trace-1' },
  );
}

describe('advanceWithAnswer', () => {
  it('hands the K4 hook the language the switch just landed on', async () => {
    await submit();

    expect(calls.indexOf('trackLanguage')).toBeLessThan(calls.indexOf('promoteNextQuestion'));
    expect(languageSeenByHook).toBe('tr');
  });

  it('runs the hook under the interview ceiling', async () => {
    await submit();

    expect(calls).toContain('withBudget');
    expect(calls.indexOf('withBudget')).toBeLessThan(calls.indexOf('promoteNextQuestion'));
  });

  it('drops to non-adaptive rather than failing the turn once the budget is gone', async () => {
    budgetSpent.value = true;

    // Resolves: the answer is stored and the default next question is askable. The tech-batch
    // ceiling above raises 402 on the same condition; this one must not.
    await expect(submit()).resolves.toMatchObject({ nextIndex: 4 });
    expect(promoteNextQuestion).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.anything(), 'ADAPTIVE_SKIPPED_NO_BUDGET');
  });
});
