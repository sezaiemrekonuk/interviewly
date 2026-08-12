/**
 * Issue 196 — the weakest-questions ranking, against a real Postgres.
 *
 * No mock can see this defect, and no unit test of the handler's *shape* could either. The bug
 * was a real `ORDER BY` over real rows: `score ASC, question_id ASC LIMIT 5` ranked one row per
 * scored answer, and once more rows tied at the lowest score than there were slots, the cuid
 * tie-break — timestamp-led, so oldest first — decided the entire list. Every assertion below
 * fails against that query and passes against the aggregate that replaced it.
 *
 * The fixtures deliberately reproduce the two shapes that broke it: the same wording scored
 * across several interviews (which the old query counted as unrelated rows), and a single
 * newer 0 (which the old query could never surface).
 *
 * NOT part of `npm test` — needs Postgres:
 *
 *   docker compose -f compose.yaml -f compose.dev.yaml up -d db cache
 *   npm run test:integration
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/db';

import { weakestQuestions } from './stats';

/** Unique per run, so the rows are findable in a database that already holds others. */
const RUN = randomUUID().slice(0, 8);
const WEAK_REPEATED = `n196 ${RUN} repeated wording scored zero`;
const WEAK_ONCE = `n196 ${RUN} single answer scored zero`;
const MIDDLING = `n196 ${RUN} wording scored middling`;
const STRONG = `n196 ${RUN} wording scored well`;

let userId: string;
let personaId: string;
const interviewIds: string[] = [];

/**
 * One interview carrying one scored answer per wording given. Separate interviews are the
 * point: a `questions` row belongs to exactly one of them, so "the same question" across
 * interviews is several rows with the same `text` and different ids.
 */
async function seedInterview(scores: Record<string, number>): Promise<void> {
  const interview = await prisma.interview.create({
    data: {
      user_id: userId,
      mode: 'text',
      job_text: 'Backend engineer.',
      job_source: 'paste',
      occupation: 'Backend Engineer',
      language: 'en',
      target_question_count: Object.keys(scores).length,
      hr_question_count: Object.keys(scores).length,
      state: 'completed',
    },
  });
  interviewIds.push(interview.id);

  const round = await prisma.interviewRound.create({
    data: { interview_id: interview.id, type: 'hr', persona_id: personaId },
  });

  // The narrative (`overall_score`, `summary`, `strengths`) lives in the optional `payload`
  // json; the ranking reads none of it, so the row carries only what the schema requires.
  const report = await prisma.report.create({
    data: {
      interview_id: interview.id,
      status: 'ready',
      prompt_uuid: randomUUID(),
      prompt_version: 1,
    },
  });

  let order = 0;
  for (const [text, score] of Object.entries(scores)) {
    const question = await prisma.question.create({
      data: {
        round_id: round.id,
        order_index: order++,
        text,
        kind: 'behavioral',
        difficulty: 'easy',
        topic: 'fixture',
      },
    });
    await prisma.reportQuestion.create({
      data: {
        report_id: report.id,
        question_id: question.id,
        score,
        reason: 'fixture',
        star_adherence: 0.5,
      },
    });
  }
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email_lower: `n196-${randomUUID()}@test.local` },
  });
  userId = user.id;

  const persona = await prisma.persona.create({
    data: {
      role: 'HR Interviewer',
      name: 'N196 fixture',
      voice_id: 'none',
      avatar_set: {},
      system_prompt: 'You are the fixture interviewer.',
    },
  });
  personaId = persona.id;

  // The repeated wording is scored 0 in three separate interviews; the others once each.
  await seedInterview({ [WEAK_REPEATED]: 0, [MIDDLING]: 50, [STRONG]: 90 });
  await seedInterview({ [WEAK_REPEATED]: 0, [MIDDLING]: 60 });
  await seedInterview({ [WEAK_REPEATED]: 0, [WEAK_ONCE]: 0 });
});

afterAll(async () => {
  // Ordered by the FK chain: every relation in this schema is onDelete: Restrict, so nothing
  // cascades and a child left behind blocks its parent. Issue 170's residue is what this
  // repo looks like without it.
  for (const id of interviewIds) {
    const report = await prisma.report.findUnique({ where: { interview_id: id } });
    if (report) {
      await prisma.reportQuestion.deleteMany({ where: { report_id: report.id } });
      await prisma.report.delete({ where: { id: report.id } });
    }
    const rounds = await prisma.interviewRound.findMany({ where: { interview_id: id } });
    for (const round of rounds) {
      await prisma.question.deleteMany({ where: { round_id: round.id } });
    }
    await prisma.interviewRound.deleteMany({ where: { interview_id: id } });
    await prisma.interview.delete({ where: { id } });
  }
  await prisma.persona.delete({ where: { id: personaId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

/** This run's rows, in the order the query returned them, ignoring whatever else is stored. */
async function ourRows() {
  const all = await weakestQuestions(10_000);
  return all.filter((row) => row.text.startsWith(`n196 ${RUN} `));
}

describe('weakestQuestions', () => {
  it('returns one row per wording, not one per scored answer', async () => {
    const rows = await ourRows();
    expect(rows.map((r) => r.text)).toHaveLength(4);

    const repeated = rows.find((r) => r.text === WEAK_REPEATED);
    // Three interviews scored this wording. The old query would have listed it three times.
    expect(repeated).toMatchObject({ score: 0, sample_size: 3 });
  });

  it('scores a wording by its mean, not by its worst or its first row', async () => {
    const rows = await ourRows();
    // 50 and 60 across two interviews — neither endpoint, and not the row the old ORDER BY
    // would have picked.
    expect(rows.find((r) => r.text === MIDDLING)).toMatchObject({ score: 55, sample_size: 2 });
  });

  it('ranks weakest first, and breaks a tie on how often the question was asked', async () => {
    const ours = (await ourRows()).map((r) => r.text);
    // Both zero-scored wordings outrank the scored ones, and among them the one asked three
    // times comes first — a wording scored 0 once is weaker evidence, not a weaker question.
    expect(ours).toEqual([WEAK_REPEATED, WEAK_ONCE, MIDDLING, STRONG]);
  });

  it('surfaces a question scored badly today, which the row ranking could not', async () => {
    // WEAK_ONCE is the newest row in the fixture and its question has the newest cuid, so
    // `ORDER BY score ASC, question_id ASC` put it last among the zeroes and out of the top
    // five entirely once older zeroes existed. It is second here.
    const ours = (await ourRows()).map((r) => r.text);
    expect(ours.indexOf(WEAK_ONCE)).toBeLessThan(ours.indexOf(MIDDLING));
  });

  it('honours the limit, so the panel gets five rows and not the whole corpus', async () => {
    expect((await weakestQuestions()).length).toBeLessThanOrEqual(5);
  });
});
