/** `admin_cost.feature` — N01 (@AC-17) soft-delete audit; N02 (@AC-18) stats + role gate. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { hash } from '@node-rs/argon2';
import { Given, Then, When } from '@cucumber/cucumber';

import { prisma } from '../../src/lib/db';

import { AiWorld } from './world';

const ADMIN_PASSWORD = 'correct-horse-battery';

/** Two calls, so `totalTokens` proves a SUM rather than a single row read. */
const CALLS = [
  { input_tokens: 1200, output_tokens: 900, cost_usd: '0.021000' },
  { input_tokens: 1500, output_tokens: 610, cost_usd: '0.020200' },
];
const TOTAL_TOKENS = CALLS.reduce((n, c) => n + c.input_tokens + c.output_tokens, 0);
const SPENT_USD = '0.041200';

/** AC-18: tokens for the soft-deleted interview — proves K11 for /admin/stats. */
const DELETED_CALLS = [{ input_tokens: 400, output_tokens: 300, cost_usd: '0.007000' }];
const DELETED_TOKENS = DELETED_CALLS.reduce((n, c) => n + c.input_tokens + c.output_tokens, 0);

interface AdminItem {
  id: string;
  deleted: boolean;
  costUsd: string;
  totalTokens: number;
}

const items = <T>(world: AiWorld): T[] => (world.lastBody?.items ?? []) as T[];

/**
 * A fresh admin, signed in, cookie returned and left on the world.
 *
 * Exported because `report-job.steps.ts` needs the same actor for the requeue endpoint
 * (issue 081), and a second copy of the create-then-login dance would drift from this one —
 * `admin` is a seeded role here, not something any endpoint can grant.
 */
export async function signInAsAdmin(world: AiWorld): Promise<string> {
  const admin = await prisma.user.create({
    data: {
      email_lower: `admin-${randomUUID()}@example.com`,
      password_hash: await hash(ADMIN_PASSWORD),
      role: 'admin',
      email_verified_at: new Date(),
    },
  });

  world.cookie = '';
  await world.httpPost('/auth/login', { email: admin.email_lower, password: ADMIN_PASSWORD });
  assert.equal(world.lastStatus, 200, `admin login failed: ${JSON.stringify(world.lastBody)}`);
  return world.cookie;
}

async function register(world: AiWorld): Promise<string> {
  await world.httpPost('/auth/register', {
    email: `candidate-${randomUUID()}@example.com`,
    password: ADMIN_PASSWORD,
    consent: true,
  });
  assert.equal(world.lastStatus, 201, `register failed: ${JSON.stringify(world.lastBody)}`);
  return world.cookie;
}

Given('a candidate owns an interview with recorded cost', async function (this: AiWorld) {
  this.actors.owner = await register(this);
  const ownerId = (this.lastBody?.user as { id: string }).id;

  // The suite runs `prisma migrate deploy` without `npm run seed`, so the cluster K11 groups
  // by has to exist before an interview can FK to it.
  const cluster = await prisma.occupationCluster.upsert({
    where: { key: 'software' },
    update: {},
    create: { key: 'software', label: 'Software' },
  });

  const interview = await prisma.interview.create({
    data: {
      user_id: ownerId,
      mode: 'text',
      job_text: 'We are hiring a backend engineer.',
      job_source: 'paste',
      occupation: 'Backend Engineer',
      occupation_cluster_id: cluster.id,
      language: 'en',
      target_question_count: 8,
      hr_question_count: 3,
      state: 'completed',
      spent_usd: SPENT_USD,
    },
  });
  this.interviewId = interview.id;

  await prisma.llmCall.createMany({
    data: CALLS.map((call) => ({
      ...call,
      interview_id: interview.id,
      provider: 'openai',
      model: 'gpt-test',
      prompt_uuid: randomUUID(),
      prompt_version: 1,
      attempt_no: 1,
      units: '2100',
      unit_kind: 'token' as const,
      latency_ms: 120,
      trace_id: randomUUID(),
    })),
  });

  this.recordedCost = { costUsd: SPENT_USD, totalTokens: TOTAL_TOKENS };
});

Given('another candidate is signed in', async function (this: AiWorld) {
  this.actors.other = await register(this);
});

When('the other candidate deletes that interview', async function (this: AiWorld) {
  this.cookie = this.actors.other;
  await this.httpDelete(`/interviews/${this.interviewId}`);
});

When('the owner deletes the interview', async function (this: AiWorld) {
  this.cookie = this.actors.owner;
  await this.httpDelete(`/interviews/${this.interviewId}`);
});

When('the owner fetches GET {string}', async function (this: AiWorld, path: string) {
  this.cookie = this.actors.owner;
  await this.httpGet(path);
});

When('an admin fetches GET {string}', async function (this: AiWorld, path: string) {
  this.actors.admin = await signInAsAdmin(this);
  await this.httpGet(path);
});

Then(
  "the interview remains in the owner's GET {string} response",
  async function (this: AiWorld, path: string) {
    this.cookie = this.actors.owner;
    await this.httpGet(path);
    assert.equal(this.lastStatus, 200, `body: ${JSON.stringify(this.lastBody)}`);
    assert.ok(
      items<{ id: string }>(this).some((i) => i.id === this.interviewId),
      'the interview a non-owner failed to delete must still be in the owner list',
    );
  },
);

Then('the interview is absent', function (this: AiWorld) {
  assert.equal(this.lastStatus, 200, `body: ${JSON.stringify(this.lastBody)}`);
  assert.ok(
    !items<{ id: string }>(this).some((i) => i.id === this.interviewId),
    'a soft-deleted interview leaked into the owner list',
  );
});

Then('the interview is present with deleted true', function (this: AiWorld) {
  assert.equal(this.lastStatus, 200, `body: ${JSON.stringify(this.lastBody)}`);
  const row = items<AdminItem>(this).find((i) => i.id === this.interviewId);
  assert.ok(row, 'the soft-deleted interview is missing from the admin audit list');
  assert.equal(row.deleted, true);
});

Then('its cost is unchanged', function (this: AiWorld) {
  const row = items<AdminItem>(this).find((i) => i.id === this.interviewId);
  assert.ok(row, 'the soft-deleted interview is missing from the admin audit list');
  assert.deepEqual(
    { costUsd: row.costUsd, totalTokens: row.totalTokens },
    this.recordedCost,
    'a soft delete must not touch spent_usd or the llm_calls rows',
  );
});

// ── @AC-18 step definitions (N02) ─────────────────────────────────────────────

const DURATION_MS = 90_000;

/** Issue 143: the text `/admin/stats` must return next to the score, not the question's id. */
const WEAKEST_QUESTION_TEXT = 'Tell me about a deadline you missed.';

async function seedScoredQuestion(interviewId: string): Promise<void> {
  // The seeded personas are an F02 fixture, not something this ring owns — take whichever
  // one is there and only build a stand-in when the seed has not run.
  const persona =
    (await prisma.persona.findFirst()) ??
    (await prisma.persona.create({
      data: {
        role: 'hr',
        name: 'Acceptance HR',
        voice_id: 'test',
        avatar_set: {},
        system_prompt: 'test',
        // The stand-in is only ever an FK target — `findFirst` above takes it back without
        // asking about `active`, and leaving it selectable would let it conduct a real
        // interview on a database this ring shares (issue 257).
        active: false,
      },
    }));

  const round = await prisma.interviewRound.create({
    data: { interview_id: interviewId, type: 'hr', persona_id: persona.id, status: 'done' },
  });
  const question = await prisma.question.create({
    data: {
      round_id: round.id,
      order_index: 0,
      text: WEAKEST_QUESTION_TEXT,
      kind: 'behavioral',
      difficulty: 'easy',
      topic: 'ownership',
    },
  });
  const report = await prisma.report.create({
    data: {
      interview_id: interviewId,
      status: 'ready',
      prompt_uuid: randomUUID(),
      prompt_version: 1,
    },
  });
  await prisma.reportQuestion.create({
    data: {
      report_id: report.id,
      question_id: question.id,
      score: 0,
      reason: 'No example given.',
      star_adherence: '0.10',
    },
  });
}

Given('a non-admin user has a session', async function (this: AiWorld) {
  const agg = await prisma.llmCall.aggregate({ _sum: { input_tokens: true, output_tokens: true } });
  this.tokenBaseline = (agg._sum.input_tokens ?? 0) + (agg._sum.output_tokens ?? 0);

  this.actors.nonAdmin = await register(this);
  const userId = (this.lastBody?.user as { id: string }).id;

  const cluster = await prisma.occupationCluster.upsert({
    where: { key: 'software' },
    update: {},
    create: { key: 'software', label: 'Software' },
  });

  const now = new Date();

  // completed interview with timestamps — contributes to averageDurationMs + perOccupation
  const completed = await prisma.interview.create({
    data: {
      user_id: userId,
      mode: 'text',
      job_text: 'Backend role.',
      job_source: 'paste',
      occupation: 'Backend Engineer',
      occupation_cluster_id: cluster.id,
      language: 'en',
      target_question_count: 5,
      hr_question_count: 2,
      state: 'completed',
      spent_usd: '0.010000',
      started_at: new Date(now.getTime() - DURATION_MS),
      ended_at: now,
    },
  });

  // A scored question on that interview, so weakestQuestions is not vacuously empty and the
  // text it now ships (issue 143) is assertable. Needs the whole round → question → report
  // chain, since `report_questions` is a leaf of it.
  await seedScoredQuestion(completed.id);

  // soft-deleted interview — must appear in admin list (K11)
  const deleted = await prisma.interview.create({
    data: {
      user_id: userId,
      mode: 'text',
      job_text: 'Backend role.',
      job_source: 'paste',
      occupation: 'Backend Engineer',
      occupation_cluster_id: cluster.id,
      language: 'en',
      target_question_count: 5,
      hr_question_count: 2,
      state: 'completed',
      spent_usd: '0.005000',
      deleted_at: new Date(),
    },
  });
  this.interviewId = deleted.id;

  // llm_calls on the soft-deleted interview — proves K11: tokens counted even when deleted
  await prisma.llmCall.createMany({
    data: DELETED_CALLS.map((call) => ({
      ...call,
      interview_id: deleted.id,
      provider: 'openai',
      model: 'gpt-test',
      prompt_uuid: randomUUID(),
      prompt_version: 1,
      attempt_no: 1,
      units: String(DELETED_TOKENS),
      unit_kind: 'token' as const,
      latency_ms: 50,
      trace_id: randomUUID(),
    })),
  });

  // abandoned interview — contributes to unfinished count
  await prisma.interview.create({
    data: {
      user_id: userId,
      mode: 'text',
      job_text: 'Frontend role.',
      job_source: 'paste',
      occupation: 'Frontend Engineer',
      occupation_cluster_id: cluster.id,
      language: 'en',
      target_question_count: 5,
      hr_question_count: 2,
      state: 'abandoned',
      spent_usd: '0.000000',
    },
  });
});

When('the non-admin user fetches GET {string}', async function (this: AiWorld, path: string) {
  this.cookie = this.actors.nonAdmin;
  await this.httpGet(path);
});

When('an admin user fetches GET {string}', async function (this: AiWorld, path: string) {
  this.actors.adminUser = await signInAsAdmin(this);
  await this.httpGet(path);
});

Then('deleted interviews are included', function (this: AiWorld) {
  assert.equal(this.lastStatus, 200, `body: ${JSON.stringify(this.lastBody)}`);
  const found = items<AdminItem>(this).find((i) => i.id === this.interviewId);
  assert.ok(found, 'the soft-deleted interview must appear in the admin audit list');
  assert.equal(found.deleted, true);
});

When('the admin user fetches GET {string}', async function (this: AiWorld, path: string) {
  this.cookie = this.actors.adminUser;
  await this.httpGet(path);
});

interface AdminStats {
  averageDurationMs: number;
  completed: number;
  cutShort: number;
  unfinished: number;
  totalTokens: number;
  perOccupation: unknown[];
  weakestQuestions: { text: string; score: number; sampleSize: number }[];
}

Then('averageDurationMs is computed from completed interviews', function (this: AiWorld) {
  assert.equal(this.lastStatus, 200, `body: ${JSON.stringify(this.lastBody)}`);
  const body = this.lastBody as unknown as AdminStats;
  assert.ok(
    typeof body.averageDurationMs === 'number' && body.averageDurationMs >= 0,
    `averageDurationMs must be a non-negative number, got ${body.averageDurationMs}`,
  );
});

Then(
  'completed, unfinished, totalTokens, perOccupation and weakestQuestions are present',
  function (this: AiWorld) {
    const body = this.lastBody as unknown as AdminStats;
    assert.ok(typeof body.completed === 'number', 'completed missing');
    assert.ok(typeof body.cutShort === 'number', 'cutShort missing');
    assert.ok(typeof body.unfinished === 'number', 'unfinished missing');
    assert.ok(
      typeof body.totalTokens === 'number' && body.totalTokens >= this.tokenBaseline + DELETED_TOKENS,
      `totalTokens must include deleted interview tokens: expected >= ${this.tokenBaseline + DELETED_TOKENS}, got ${body.totalTokens}`,
    );
    assert.ok(Array.isArray(body.perOccupation), 'perOccupation missing');
    assert.ok(Array.isArray(body.weakestQuestions), 'weakestQuestions missing');
    // Issue 143: every row carries the question text, not just its id. The fixture scored a
    // question, so an empty list here would make the loop below pass on nothing.
    assert.ok(body.weakestQuestions.length > 0, 'weakestQuestions must not be empty');
    for (const q of body.weakestQuestions) {
      assert.ok(
        typeof q.text === 'string' && q.text.length > 0,
        `weakestQuestions row must carry the question text, got ${JSON.stringify(q)}`,
      );
      // Issue 196: a row is a wording aggregated over answers, so it has to say how many.
      // A mean with no sample size behind it cannot be read.
      assert.ok(
        Number.isInteger(q.sampleSize) && q.sampleSize > 0,
        `weakestQuestions row must carry a positive sampleSize, got ${JSON.stringify(q)}`,
      );
    }
    // at least one cluster row since we seeded completed interviews with a cluster
    assert.ok(body.perOccupation.length > 0, 'perOccupation must not be empty');
  },
);
