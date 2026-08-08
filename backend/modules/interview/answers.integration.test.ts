/**
 * Issue #70 — the advance and the turn are one commit.
 *
 * `answers.test.ts` covers the ordering around the write with a stubbed Prisma. It cannot
 * cover this: whether the boundary rolls back is a property of the database, and a stub that
 * models rollback would only be asserting that the stub rolls back. So the claim is made
 * against a real Postgres, where the advance either survives the failed insert or does not.
 *
 * NOT part of `npm test` — needs Postgres. Same as the worker's integration files:
 *
 *   docker compose -f compose.yaml -f compose.dev.yaml up -d db
 *   export DATABASE_URL=postgresql://interviewly:interviewly@localhost:5432/interviewly
 *   npm run test:integration
 */
import { randomUUID } from 'node:crypto';

import type { Interview, Question } from '@prisma/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../src/lib/db';

/**
 * The one seam these scenarios need, and only the first one uses it: a question row the guard
 * accepts and Postgres does not. Handing the handler an id that was never inserted makes
 * `answers.question_id` trip its foreign key *after* the advance has run — a real constraint
 * violation from inside the transaction, which is the failure the issue describes. Left null
 * for the concurrency scenario, where the real lookup runs.
 */
const seam = vi.hoisted(() => ({ question: null as Question | null }));
vi.mock('./state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./state')>();
  return {
    ...actual,
    currentQuestionRow: (interview: Parameters<typeof actual.currentQuestionRow>[0]) =>
      seam.question ? Promise.resolve(seam.question) : actual.currentQuestionRow(interview),
  };
});

const { advanceWithAnswer } = await import('./answers');

// Parked mid-technical-round: no ADR-I22 batch and no handover fire on this turn, so the
// only thing under test is the write itself.
const HR_COUNT = 2;
const INDEX = 3;

let userId: string;
let personaId: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email_lower: `i70-${randomUUID()}@test.local` },
  });
  userId = user.id;

  const persona = await prisma.persona.create({
    data: {
      role: 'Tech Interviewer',
      name: 'Issue 70 fixture',
      voice_id: 'none',
      avatar_set: {},
      system_prompt: 'fixture',
    },
  });
  personaId = persona.id;
});

afterEach(() => {
  seam.question = null;
});

async function seed(): Promise<{ interview: Interview; question: Question }> {
  const interview = await prisma.interview.create({
    data: {
      user_id: userId,
      mode: 'text',
      job_text: 'Backend engineer, Postgres experience.',
      job_source: 'paste',
      occupation: 'Backend Engineer',
      language: 'en',
      target_question_count: 8,
      hr_question_count: HR_COUNT,
      state: 'tech_round',
      current_index: INDEX,
    },
  });

  const round = await prisma.interviewRound.create({
    data: { interview_id: interview.id, type: 'tech', persona_id: personaId },
  });

  const question = await prisma.question.create({
    data: {
      round_id: round.id,
      // `current_index` is global across both rounds, `order_index` is per-round (state.ts).
      order_index: INDEX - HR_COUNT,
      text: 'Bir indeksi nasıl seçersin?',
      kind: 'technical',
      difficulty: 'medium',
      topic: 'sql-indexes',
      asked_at: new Date(),
    },
  });

  return { interview, question };
}

const submit = (interview: Interview, questionId: string) =>
  advanceWithAnswer(
    { ...interview },
    { questionId, transcript: 'Seçici sütunlara göre.', inputMode: 'text' },
    { traceId: `i70-${randomUUID()}` },
  );

const reread = (id: string): Promise<Interview> =>
  prisma.interview.findUniqueOrThrow({ where: { id } });

describe('advanceWithAnswer against Postgres', () => {
  it('rolls the advance back when the answer insert fails', async () => {
    const { interview, question } = await seed();
    const missing = `qst_${randomUUID()}`;
    seam.question = { ...question, id: missing };

    await expect(submit(interview, missing)).rejects.toThrow();

    // The whole of #70: with the advance on its own commit this row read 4, the answer did
    // not exist, and the CAS then refused every resubmit of the same question.
    expect((await reread(interview.id)).current_index).toBe(INDEX);
    expect(await prisma.chatMessage.count({ where: { interview_id: interview.id } })).toBe(0);
  }, 30_000);

  it('lets exactly one of two concurrent submits through (ADR-I06)', async () => {
    const { interview, question } = await seed();

    const results = await Promise.allSettled([
      submit(interview, question.id),
      submit(interview, question.id),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    // One advance, one answer, one message — the loser's transaction wrote nothing at all.
    expect((await reread(interview.id)).current_index).toBe(INDEX + 1);
    expect(await prisma.answer.count({ where: { question_id: question.id } })).toBe(1);
    expect(await prisma.chatMessage.count({ where: { interview_id: interview.id } })).toBe(1);
  }, 30_000);
});
