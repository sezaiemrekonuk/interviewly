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
 *
 * 3. The same for the ADR-I22 batch at the handover (#90): the answer is committed before it
 *    runs, so a provider outage there is a paused interview and a 200, not a 503 telling the
 *    candidate the answer they gave was lost.
 */
import type { Interview, InterviewState } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../src/lib/api-error';

const calls: string[] = [];

// The advance and the turn run inside one interactive transaction (#70), so what these
// scenarios need from `$transaction` is a client to hand the callback. Whether the boundary
// actually rolls back is a database question, and `answers.integration.test.ts` asks it.
/** Hoisted out of the factory so a scenario can ask whether the turn was written at all. */
const answerCreate = vi.fn(async () => ({ id: 'ans_1' }));
vi.mock('../../src/lib/db', () => {
  const tx = {
    interview: { updateMany: vi.fn(async () => ({ count: 1 })) },
    answer: { create: () => answerCreate() },
    chatMessage: { create: vi.fn(async () => ({})) },
  };
  return { prisma: { ...tx, $transaction: (fn: (c: typeof tx) => unknown) => fn(tx) } };
});

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

/**
 * The ADR-I22 batch, per scenario. The failing variant pauses the caller's copy before it
 * throws, because that is what `generation.ts` does through `applyTransition` — and the
 * handover below has to see it.
 */
const ensureTechBatch = vi.fn(async (_interview: Interview) => undefined);
vi.mock('./generation', () => ({
  ensureTechBatch: (interview: Interview) => ensureTechBatch(interview),
}));

const applyTransition = vi.fn(async (_interview: Interview, to: InterviewState) => to);
vi.mock('./machine', () => ({
  applyTransition: (interview: Interview, to: InterviewState) => applyTransition(interview, to),
}));

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
  // The tech batch's ceiling. `budget.test.ts` owns what the real one does when it refuses;
  // what matters here is the shape of the refusal it hands back — the 402 code, not
  // `BudgetExceeded`, which it converts after ending the interview.
  withBudgetOrEnd: async (_interview: Interview, fn: () => Promise<unknown>) => {
    calls.push('withBudgetOrEnd');
    if (budgetSpent.value) throw new ApiError('BUDGET_EXCEEDED');
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

// The last HR turn: `nextIndex` (5) passes `hr_question_count`, so this is the one submit that
// generates the technical batch and then hands the round over.
const atHandover = () =>
  ({ ...interview(), state: 'hr_round', current_index: 4 }) as unknown as Interview;

beforeEach(() => {
  calls.length = 0;
  languageSeenByHook = undefined;
  budgetSpent.value = false;
  promoteNextQuestion.mockClear();
  answerCreate.mockClear();
  ensureTechBatch.mockClear();
  ensureTechBatch.mockImplementation(async () => undefined);
  applyTransition.mockClear();
  warn.mockClear();
});

function submit(subject: Interview = interview()) {
  return advanceWithAnswer(
    subject,
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

  describe('when the technical batch fails at the handover (#90)', () => {
    /** What `generation.ts` does: pause through `applyTransition`, then rethrow the code. */
    function providerOutage() {
      ensureTechBatch.mockImplementation(async (subject: Interview) => {
        subject.state = 'paused';
        throw new ApiError('AI_PROVIDER_UNAVAILABLE');
      });
    }

    it('keeps the answer and reports the pause instead of failing the request', async () => {
      providerOutage();

      await expect(submit(atHandover())).resolves.toEqual({ state: 'paused', nextIndex: 5 });
      expect(answerCreate).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.anything(), 'TECH_BATCH_FAILED');
    });

    // `paused → tech_round` is not an edge, so the handover would answer 409 — replacing a
    // recorded answer with the wrong problem.
    it('does not attempt the handover out of a paused interview', async () => {
      providerOutage();

      await submit(atHandover());

      expect(applyTransition).not.toHaveBeenCalled();
    });

    // The one refusal that still fails the request: the interview has ended, and the room
    // routes 402 to a silent refetch that lands on the ended state (@AC-11, I08).
    it('still raises BUDGET_EXCEEDED', async () => {
      budgetSpent.value = true;

      await expect(submit(atHandover())).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
      expect(answerCreate).toHaveBeenCalled();
    });
  });

  it('hands the round over when the batch lands', async () => {
    await expect(submit(atHandover())).resolves.toEqual({ state: 'tech_round', nextIndex: 5 });
    expect(ensureTechBatch).toHaveBeenCalled();
  });
});
