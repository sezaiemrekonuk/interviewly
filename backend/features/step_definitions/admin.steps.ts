/**
 * `admin_cost.feature` @AC-17 — soft delete disappears for the owner and stays auditable,
 * cost intact, for an admin (N01). @AC-18 is N02's and is still tagged `@unwired`.
 */
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

interface AdminItem {
  id: string;
  deleted: boolean;
  costUsd: string;
  totalTokens: number;
}

const items = <T>(world: AiWorld): T[] => (world.lastBody?.items ?? []) as T[];

async function register(world: AiWorld): Promise<string> {
  await world.httpPost('/auth/register', {
    email: `candidate-${randomUUID()}@example.com`,
    password: ADMIN_PASSWORD,
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
  const admin = await prisma.user.create({
    data: {
      email_lower: `admin-${randomUUID()}@example.com`,
      password_hash: await hash(ADMIN_PASSWORD),
      role: 'admin',
      email_verified_at: new Date(),
    },
  });

  this.cookie = '';
  await this.httpPost('/auth/login', { email: admin.email_lower, password: ADMIN_PASSWORD });
  assert.equal(this.lastStatus, 200, `admin login failed: ${JSON.stringify(this.lastBody)}`);
  this.actors.admin = this.cookie;

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
