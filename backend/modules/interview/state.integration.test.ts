/**
 * T03 — the room's message filter, against a real Postgres.
 *
 * There is exactly one defect worth this file, and no mock can see it: `action: { notIn: [...] }`
 * compiles to SQL that is NULL wherever `action` is null, and NULL is not TRUE, so the row is
 * excluded. Every candidate turn has `action = null`. Drop the explicit `action: null` branch and
 * the entire candidate side of the conversation vanishes from the room — while `/state` still
 * returns a `messages` array, still 200s, and every unit test that asserts the filter's *shape*
 * still passes.
 *
 * NOT part of `npm test` — needs Postgres:
 *
 *   docker compose -f compose.yaml -f compose.dev.yaml up -d db cache
 *   export DATABASE_URL=postgresql://interviewly:interviewly@localhost:5432/interviewly
 *   npm run test:integration
 */
import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/db';

import { __testing } from './state';

const { resolveMessages } = __testing;

let userId: string;
let personaId: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email_lower: `t03-${randomUUID()}@test.local` },
  });
  userId = user.id;

  const persona = await prisma.persona.create({
    data: {
      role: 'HR Interviewer',
      name: 'T03 fixture',
      voice_id: 'none',
      avatar_set: {},
      system_prompt: 'You are the fixture interviewer.',
    },
  });
  personaId = persona.id;
});

/** One interview with one HR question — the room only needs somewhere to hang the rows. */
async function seed() {
  const interview = await prisma.interview.create({
    data: {
      user_id: userId,
      mode: 'voice',
      job_text: 'Backend engineer, Postgres experience.',
      job_source: 'paste',
      occupation: 'Backend Engineer',
      language: 'en',
      target_question_count: 2,
      hr_question_count: 1,
      state: 'hr_round',
      current_index: 1,
    },
  });
  const round = await prisma.interviewRound.create({
    data: { interview_id: interview.id, type: 'hr', persona_id: personaId },
  });
  const question = await prisma.question.create({
    data: {
      round_id: round.id,
      order_index: 1,
      text: 'Tell me about a deadline you missed.',
      kind: 'behavioral',
      difficulty: 'medium',
      topic: 'teamwork',
      intent: 'find out how they handle slipping',
      asked_at: new Date(),
    },
  });
  return { interview, question };
}

const write = (
  interviewId: string,
  questionId: string | null,
  role: 'user' | 'assistant' | 'system',
  content: string,
  action: 'continue' | 'drift' | 'refused' | 'silence' | null,
) =>
  prisma.chatMessage.create({
    data: {
      interview_id: interviewId,
      role,
      content,
      action,
      question_id: questionId,
      trace_id: `t03-${randomUUID()}`,
    },
  });

describe('resolveMessages (T03)', () => {
  it('hides the silence and refusal notes while keeping every candidate row (@AC-8)', async () => {
    const { interview, question } = await seed();
    await write(interview.id, question.id, 'assistant', 'Tell me about a deadline.', 'continue');
    await write(interview.id, question.id, 'user', 'I missed one by a week.', null);
    await write(interview.id, question.id, 'system', '[The candidate has said nothing for 13 seconds.]', 'silence');
    await write(interview.id, null, 'system', 'You asked to end this interview. Refused.', 'refused');
    await write(interview.id, null, 'system', 'The interviewer was moved on.', 'drift');
    await write(interview.id, question.id, 'user', 'The migration had not been rehearsed.', null);

    const shown = await resolveMessages(interview.id);

    // The candidate side first: this is the assertion that goes red if the null branch is lost.
    expect(shown.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
      'I missed one by a week.',
      'The migration had not been rehearsed.',
    ]);
    expect(shown.map((m) => m.action)).not.toContain('silence');
    expect(shown.map((m) => m.action)).not.toContain('refused');
    // The drift note is about the candidate's own turn, not about a rule they could aim at.
    expect(shown.map((m) => m.action)).toContain('drift');
  }, 30_000);
});
