/**
 * R04's staleness predicate against a real Postgres. `abandon-sweep.test.ts` covers the loop
 * around the query; this covers the query — which rows it selects and which it leaves alone.
 * The predicate is SQL (`created_at`/`started_at`/`chat_messages` vs a cutoff, plus the state
 * and soft-delete filters), so asserting it against a stubbed `findMany` would only re-state
 * the object literal. Only the database can say whether it means what it should.
 *
 * NOT part of `npm test` — needs Postgres. Same as `consumer.integration.test.ts`:
 *
 *   docker compose -f compose.yaml -f compose.dev.yaml up -d db cache
 *   export DATABASE_URL=postgresql://interviewly:interviewly@localhost:5432/interviewly
 *   export REDIS_URL=redis://localhost:6380
 *   npm run test:integration
 */
import { randomUUID } from 'node:crypto';

import type { EndedReason, Interview, InterviewState } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@interviewly/backend';

import { sweepAbandoned } from './abandon-sweep';

const HOUR = 60 * 60 * 1000;
const ago = (ms: number): Date => new Date(Date.now() - ms);

let userId: string;

interface SeedOpts {
  state: InterviewState;
  createdAt: Date;
  startedAt?: Date | null;
  /** `created_at` of a single chat message, i.e. the last answered turn. */
  lastMessageAt?: Date;
  deletedAt?: Date | null;
}

async function seed(opts: SeedOpts): Promise<string> {
  const interview = await prisma.interview.create({
    data: {
      user_id: userId,
      mode: 'text',
      job_text: 'Backend engineer, Postgres experience.',
      job_source: 'paste',
      occupation: 'Backend Engineer',
      language: 'en',
      target_question_count: 5,
      hr_question_count: 3,
      state: opts.state,
      created_at: opts.createdAt,
      started_at: opts.startedAt ?? null,
      deleted_at: opts.deletedAt ?? null,
    },
  });

  if (opts.lastMessageAt) {
    await prisma.chatMessage.create({
      data: {
        interview_id: interview.id,
        role: 'user',
        content: 'An answered turn.',
        trace_id: `r04-${randomUUID()}`,
        created_at: opts.lastMessageAt,
      },
    });
  }

  return interview.id;
}

const read = (id: string): Promise<Interview> =>
  prisma.interview.findUniqueOrThrow({ where: { id } });

async function expectEnded(id: string, from: InterviewState): Promise<void> {
  const interview = await read(id);
  expect({ state: interview.state, ended_reason: interview.ended_reason }).toEqual({
    state: 'abandoned' as InterviewState,
    ended_reason: 'abandoned' as EndedReason,
  });
  // The row really was in a sweepable state — a fixture that started out `abandoned` would
  // satisfy the assertion above without the sweeper having done anything.
  expect(from).not.toBe('abandoned');
}

async function expectUntouched(id: string, state: InterviewState): Promise<void> {
  const interview = await read(id);
  expect({ state: interview.state, ended_reason: interview.ended_reason }).toEqual({
    state,
    ended_reason: null,
  });
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email_lower: `r04-${randomUUID()}@test.local` },
  });
  userId = user.id;
});

describe('sweepAbandoned staleness predicate', () => {
  it('ends stale profiling/hr_round/tech_round/paused interviews and leaves everything else alone', async () => {
    // Stale: last activity older than 24 h by every signal.
    const staleProfiling = await seed({ state: 'profiling', createdAt: ago(50 * HOUR) });
    const staleHr = await seed({
      state: 'hr_round',
      createdAt: ago(50 * HOUR),
      startedAt: ago(49 * HOUR),
      lastMessageAt: ago(30 * HOUR),
    });
    // In scope since #104 gave the machine a `tech_round → abandoned` edge. It is where a
    // candidate who gives up actually stops, so it was also where they piled up: 255 of them,
    // more than every other sweepable state put together, none reachable by any path.
    const staleTech = await seed({
      state: 'tech_round',
      createdAt: ago(50 * HOUR),
      startedAt: ago(49 * HOUR),
      lastMessageAt: ago(28 * HOUR),
    });
    const stalePaused = await seed({
      state: 'paused',
      createdAt: ago(50 * HOUR),
      startedAt: ago(48 * HOUR),
      lastMessageAt: ago(25 * HOUR),
    });

    // Fresh by one signal each — the three fallbacks in the derived last-activity definition.
    const freshByCreation = await seed({ state: 'profiling', createdAt: ago(2 * HOUR) });
    const freshByStart = await seed({
      state: 'paused',
      createdAt: ago(50 * HOUR),
      startedAt: ago(1 * HOUR),
    });
    const freshByMessage = await seed({
      state: 'hr_round',
      createdAt: ago(50 * HOUR),
      startedAt: ago(49 * HOUR),
      lastMessageAt: ago(1 * HOUR),
    });

    // Fresh in the newly-swept state too: adding `tech_round` must widen which states the
    // sweep considers, not how stale a row has to be before it takes one.
    const freshTech = await seed({
      state: 'tech_round',
      createdAt: ago(50 * HOUR),
      startedAt: ago(49 * HOUR),
      lastMessageAt: ago(1 * HOUR),
    });

    // Old, but out of scope: pre-start, evaluating, terminal, soft-deleted.
    const created = await seed({ state: 'created', createdAt: ago(50 * HOUR) });
    const evaluating = await seed({ state: 'evaluating', createdAt: ago(50 * HOUR) });
    const completed = await seed({ state: 'completed', createdAt: ago(50 * HOUR) });
    const deleted = await seed({
      state: 'paused',
      createdAt: ago(50 * HOUR),
      deletedAt: ago(10 * HOUR),
    });

    await sweepAbandoned();

    await expectEnded(staleProfiling, 'profiling');
    await expectEnded(staleHr, 'hr_round');
    await expectEnded(staleTech, 'tech_round');
    await expectEnded(stalePaused, 'paused');

    await expectUntouched(freshByCreation, 'profiling');
    await expectUntouched(freshByStart, 'paused');
    await expectUntouched(freshByMessage, 'hr_round');
    await expectUntouched(freshTech, 'tech_round');

    await expectUntouched(created, 'created');
    await expectUntouched(evaluating, 'evaluating');
    await expectUntouched(completed, 'completed');
    // K13: a soft-deleted interview is already gone from the user's view and must not come
    // back as `abandoned`.
    await expectUntouched(deleted, 'paused');
    expect((await read(deleted)).deleted_at).not.toBeNull();
  }, 30_000);

  it('ends an interview exactly once across repeated sweeps', async () => {
    const id = await seed({ state: 'paused', createdAt: ago(50 * HOUR) });

    await sweepAbandoned();
    const afterFirst = await read(id);
    // The second sweep must not even see the row: `abandoned` is outside `SWEEP_STATES`, so
    // there is nothing for `applyTransition`'s WHERE guard to reject.
    await sweepAbandoned();

    expect(await read(id)).toEqual(afterFirst);
    expect(afterFirst.state).toBe('abandoned');
  }, 30_000);

  it('leaves a resumed interview alone once the resume writes a turn', async () => {
    const id = await seed({ state: 'paused', createdAt: ago(50 * HOUR) });
    // A resume alone does not clear staleness — `paused → hr_round` moves the state but no
    // timestamp, and `hr_round` is stale-able too. The answered turn is what makes it fresh,
    // which is exactly why last activity is derived from `chat_messages`.
    await prisma.interview.update({ where: { id }, data: { state: 'hr_round' } });
    await prisma.chatMessage.create({
      data: {
        interview_id: id,
        role: 'user',
        content: 'Back after a break.',
        trace_id: `r04-${randomUUID()}`,
      },
    });

    await sweepAbandoned();

    await expectUntouched(id, 'hr_round');
  }, 30_000);
});
