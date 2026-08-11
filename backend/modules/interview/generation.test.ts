/**
 * Issue #54: the room's only nudge used to arrive with the state change, which `POST /profile`
 * publishes *before* it calls the model — so the client refetched into `currentQuestion: null`
 * and waited on a second event that never came. The fix is an event emitted once the batch is
 * committed, and what makes it a fix is the *ordering*: a scenario that only asserts "an event
 * was published" passes just as well with the publish back in front of the insert.
 */
import type { Interview } from '@prisma/client';
import { AiError } from '@interviewly/ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const order: string[] = [];

const tx = {
  interviewRound: { upsert: vi.fn(async () => ({ id: 'rnd_1' })) },
  question: {
    createMany: vi.fn(async () => {
      order.push('questions-written');
      return { count: 2 };
    }),
  },
};

const existingQuestions = { count: 0 };

// Models the polluted dev DB: the seed row lives on its deterministic id, and a stray fixture
// (cuid id, which sorts before `seed-…`) is the by-role `orderBy id asc` winner. The resolver
// must pick the seed off its id, never the fixture the role query would hand back.
const personaFindFirst = vi.fn(async ({ where }: { where: { id?: string; role?: string } }) => {
  if (where.id?.startsWith('seed-persona-'))
    return { id: where.id, name: 'Ada', system_prompt: 'seeded brief' };
  return { id: 'cmsnfixture0000', role: where.role, name: 'Stub Persona', system_prompt: 'stub' };
});

/** The HR batch already on disk when the technical one is generated (ADR-I22). */
const hrTopics = [{ topic: 'teamwork' }, { topic: 'motivation' }, { topic: 'teamwork' }];
const questionFindMany = vi.fn(async () => hrTopics);

vi.mock('../../src/lib/db', () => ({
  prisma: {
    question: { count: vi.fn(async () => existingQuestions.count), findMany: questionFindMany },
    persona: { findFirst: personaFindFirst },
    $transaction: (run: (client: unknown) => Promise<unknown>) => run(tx),
  },
}));

// Imported for `aiClient()`, which every call here injects past — but the module reads the
// validated env at import time, and this unit has none.
vi.mock('../ai', () => ({ aiClient: vi.fn() }));

const publishQuestionsReady = vi.fn(async () => {
  order.push('event-published');
});

vi.mock('./sse', () => ({
  QUESTIONS_READY: 'INTERVIEW_QUESTIONS_READY',
  publishQuestionsReady,
  publishStateChanged: vi.fn(),
  enqueueReport: vi.fn(),
}));

const { generateRound, seededPersona } = await import('./generation');

const interview = {
  id: 'itv_1',
  state: 'hr_round',
  hr_question_count: 2,
  target_question_count: 4,
  job_text: 'Backend engineer',
  language: 'en',
  candidate_profile: null,
} as unknown as Interview;

const client = {
  generateRoundQuestions: vi.fn(async () => ({
    questions: [
      { text: 'Tell me about a conflict.', kind: 'behavioural', difficulty: 2, topic: 'teamwork' },
      { text: 'Why this role?', kind: 'behavioural', difficulty: 1, topic: 'motivation' },
    ],
  })),
};

beforeEach(() => {
  order.length = 0;
  existingQuestions.count = 0;
  publishQuestionsReady.mockClear();
  questionFindMany.mockClear();
  client.generateRoundQuestions.mockClear();
});

describe('generateRound', () => {
  it('publishes the questions-ready event after the batch is committed, never before', async () => {
    await generateRound(interview, 'hr', {
      traceId: 'trc_1',
      client: client as never,
    });

    expect(order).toEqual(['questions-written', 'event-published']);
    expect(publishQuestionsReady).toHaveBeenCalledWith({
      type: 'INTERVIEW_QUESTIONS_READY',
      interviewId: 'itv_1',
      roundType: 'hr',
    });
  });

  it('names the round it generated, so a tech handover is not reported as an HR one', async () => {
    await generateRound(interview, 'tech', {
      traceId: 'trc_1',
      client: client as never,
    });

    expect(publishQuestionsReady).toHaveBeenCalledWith(
      expect.objectContaining({ roundType: 'tech' }),
    );
  });

  /**
   * `priorTopics` has been a variable on this prompt since v1 with nothing bound to it, so
   * every technical batch was written blind to the HR round and the two converged — which is
   * how the technical interviewer opened by asking what HR had just asked. Asserted on the
   * ARGUMENT rather than on the query, because a `findMany` that runs and whose result is
   * dropped on the floor is exactly the defect this fixes.
   */
  it('tells the technical batch which topics the HR round already covers', async () => {
    await generateRound(interview, 'tech', { traceId: 'trc_1', client: client as never });

    expect(client.generateRoundQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ priorTopics: ['teamwork', 'motivation'] }),
    );
  });

  // HR is generated first and from nothing, so it has no prior round to avoid — and reading
  // one would be a query that can only ever return zero rows.
  it('sends no prior topics for the HR round', async () => {
    await generateRound(interview, 'hr', { traceId: 'trc_1', client: client as never });

    expect(questionFindMany).not.toHaveBeenCalled();
    expect(client.generateRoundQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ priorTopics: [] }),
    );
  });

  // The idempotent early return. The round that is already full had its event when it was
  // written, and the caller that lost the race still gets its own HTTP response.
  it('publishes nothing when the round is already full', async () => {
    existingQuestions.count = 2;

    await generateRound(interview, 'hr', { traceId: 'trc_1', client: client as never });

    expect(client.generateRoundQuestions).not.toHaveBeenCalled();
    expect(publishQuestionsReady).not.toHaveBeenCalled();
  });

  // A questions-ready event for questions that do not exist would send the room to refetch the
  // same empty state it is already showing — the exact loop this event exists to break.
  //
  // Driven from `profiling`, which is issue #54's own path: there is no `paused` edge out of it
  // (`machine.ts`), so the failure raises without also reaching the transition this file mocks.
  it('publishes nothing when generation fails', async () => {
    const failing = {
      generateRoundQuestions: vi.fn(async () => {
        throw new AiError('AI_PROVIDER_UNAVAILABLE', 'provider down');
      }),
    };

    await expect(
      generateRound({ ...interview, state: 'profiling' }, 'hr', {
        traceId: 'trc_1',
        client: failing as never,
      }),
    ).rejects.toThrow();

    expect(publishQuestionsReady).not.toHaveBeenCalled();
  });
});

// Regression for the leftover "Stub Persona" conducting HR rounds: with the seed present, a
// stray fixture must never win selection. Shared by generation-time assignment and the room's
// name read, so this pins both.
describe('seededPersona', () => {
  it('picks the seed off its id, not the by-role fixture', async () => {
    expect((await seededPersona('hr')).id).toBe('seed-persona-hr');
    expect((await seededPersona('tech')).id).toBe('seed-persona-tech');
  });
});
