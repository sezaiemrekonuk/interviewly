/**
 * `schema_validation.feature` @AC-11 — the report schema gate (I09).
 *
 * The job is driven by calling `runReport` directly, which is what the feature's "the report
 * job runs" means: there is no endpoint, and the report ledger's BullMQ worker will call the
 * same function. Everything before it is real — the interview reaches `evaluating` by being
 * answered over HTTP — so the state the gate transitions out of is one the app produced.
 *
 * The scenario runs both branches against ONE narrative interview, but `failed` is terminal in
 * the K2 table (I07): nothing transitions out of it. So the second "the report job runs"
 * provisions a fresh subject in `evaluating` and the assertions that follow are about that one.
 */
import assert from 'node:assert/strict';
import { After, Given, Then, When } from '@cucumber/cucumber';
import type { AiClient, ReportPayload } from '@interviewly/ai';

import { aiClient } from '../../modules/ai';
import { runReport } from '../../modules/interview/report-run';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

import { arriveAtQuestion, questionIdAt } from './answers.steps';
import { AiWorld } from './world';

const TOTAL_QUESTIONS = 5;

/** What the injected client returns on the next run. */
let payloadKind: 'valid' | 'overall_score_out_of_range' = 'valid';

const realWarn = logger.warn;

// The gate's event is a log line, not a Redis message: `AI_OUTPUT_SCHEMA_INVALID` says the
// payload was rejected, which no other observer sees. Patching the singleton the way
// answers.steps.ts patches `clock.now`, restored here so a later scenario logs normally.
After(function restoreLogger() {
  logger.warn = realWarn;
});

function captureWarnings(world: AiWorld): void {
  world.resetEvents();
  logger.warn = function capturedWarn(obj: unknown, msg?: string) {
    if (typeof msg === 'string') {
      world.events.push({ level: 'warn', event: msg, fields: obj as Record<string, unknown> });
    }
    return realWarn.call(logger, obj as object, msg);
  } as typeof logger.warn;
}

async function stateOf(id: string): Promise<string> {
  return (await prisma.interview.findUniqueOrThrow({ where: { id } })).state;
}

/** A fresh interview answered end to end, so it is in `evaluating` for real reasons. */
async function reachEvaluating(world: AiWorld): Promise<void> {
  await arriveAtQuestion(world, 1, TOTAL_QUESTIONS);
  for (let i = 1; i <= TOTAL_QUESTIONS; i++) {
    await world.httpGet(`/interviews/${world.interviewId}/state`);
    await world.httpPost(`/interviews/${world.interviewId}/answers`, {
      questionId: await questionIdAt(world, i),
      transcript: `An answer to question ${i}.`,
      inputMode: 'text',
    });
    assert.equal(world.lastStatus, 200, `answer ${i} failed: ${JSON.stringify(world.lastBody)}`);
  }
  assert.equal(await stateOf(world.interviewId), 'evaluating');
}

/**
 * A payload keyed to the interview's real question ids — an invented id would be dropped
 * before `report_questions`, and "every stored questions[].score" would assert over nothing.
 */
async function payloadFor(world: AiWorld): Promise<ReportPayload> {
  const questions = await prisma.question.findMany({
    where: { round: { interview_id: world.interviewId } },
  });
  return {
    overall_impression: 'The candidate answered every question and stayed on topic throughout.',
    overall_score: payloadKind === 'overall_score_out_of_range' ? 101 : 80,
    strengths: ['Answers stayed on topic', 'Consistent structure'],
    improvements: ['Add concrete metrics', 'Close with the outcome'],
    rounds: [
      { type: 'hr', score: 80, summary: 'Communicated clearly.' },
      { type: 'tech', score: 60, summary: 'Reasonable depth on the core topic.' },
    ],
    questions: questions.map((q, i) => ({
      question_id: q.id,
      score: (i % 5) * 20,
      reason: 'Addressed the question with a concrete example.',
      star_adherence: 0.5,
    })),
    language: 'en',
  };
}

/** Only `generateReport` is replaced — the gate under test is the one in `runReport`. */
function clientReturning(payload: ReportPayload): AiClient {
  return { ...aiClient(), generateReport: async () => payload };
}

// ---------------------------------------------------------------- given

Given('an interview has reached {string}', async function (this: AiWorld, state: string) {
  assert.equal(state, 'evaluating', `no fixture takes an interview to ${state}`);
  await reachEvaluating(this);
});

// ---------------------------------------------------------------- when

When(
  'the stub AI is configured to return a report with overall_score {int}',
  function (score: number) {
    assert.equal(score, 101, 'the malformed fixture is overall_score 101');
    payloadKind = 'overall_score_out_of_range';
  },
);

When('the stub AI is configured to return a schema-valid ReportPayload', function () {
  payloadKind = 'valid';
});

When('the report job runs', async function (this: AiWorld) {
  // `failed` is terminal, so a second run needs its own subject (see the header note).
  if ((await stateOf(this.interviewId)) !== 'evaluating') await reachEvaluating(this);

  captureWarnings(this);
  await runReport(this.interviewId, {
    traceId: `trace-${this.interviewId}`,
    client: clientReturning(await payloadFor(this)),
  });
});

// ---------------------------------------------------------------- then

Then('no report payload is stored for the interview', async function (this: AiWorld) {
  // The step's own name is the property, and it is the one that survives issue #123: the
  // invalid branch stores nothing readable. What changed is that the row now exists and says
  // `failed`, where before its absence was the only signal — and an absence cannot tell a
  // failed report apart from one that was never started.
  const row = await prisma.report.findFirst({ where: { interview_id: this.interviewId } });
  assert.equal(row?.payload ?? null, null, 'the invalid branch must store no payload');
  assert.notEqual(row?.status, 'ready', 'a refused payload must not leave a ready report');
});

// `an "…" event is emitted` is ai-provider.steps.ts's regex over `world.events`, which is why
// `captureWarnings` fills that same array instead of collecting into a local one.

async function storedPayload(world: AiWorld): Promise<ReportPayload> {
  const report = await prisma.report.findFirstOrThrow({
    where: { interview_id: world.interviewId },
  });
  return report.payload as ReportPayload;
}

function assertScore(value: unknown, label: string): void {
  assert.equal(typeof value, 'number', `${label} is not a number`);
  assert.ok(Number.isInteger(value), `${label} is not an integer`);
  assert.ok((value as number) >= 0 && (value as number) <= 100, `${label} is outside 0..100`);
}

Then('the stored report overall_score is an integer in 0..100', async function (this: AiWorld) {
  assertScore((await storedPayload(this)).overall_score, 'overall_score');
});

Then('every stored rounds[].score is an integer in 0..100', async function (this: AiWorld) {
  const payload = await storedPayload(this);
  assert.ok(payload.rounds.length > 0, 'no rounds in the stored payload');
  for (const round of payload.rounds) assertScore(round.score, `rounds[${round.type}].score`);
});

// Asserted against `report_questions` as well as the payload: the denormalised copy is what
// the admin "weakest questions" query reads, and a payload-only check would not notice it
// being empty.
Then('every stored questions[].score is an integer in 0..100', async function (this: AiWorld) {
  const payload = await storedPayload(this);
  assert.ok(payload.questions.length > 0, 'no questions in the stored payload');
  for (const q of payload.questions) assertScore(q.score, `questions[${q.question_id}].score`);

  const rows = await prisma.reportQuestion.findMany({
    where: { report: { interview_id: this.interviewId } },
  });
  assert.equal(rows.length, payload.questions.length);
  for (const row of rows) assertScore(row.score, `report_questions[${row.question_id}].score`);
});

Then(
  'the stored report {word} has between {int} and {int} items',
  async function (this: AiWorld, field: string, min: number, max: number) {
    const payload = await storedPayload(this);
    const items = payload[field as 'strengths' | 'improvements'];
    assert.ok(Array.isArray(items), `${field} is not an array`);
    assert.ok(items.length >= min && items.length <= max, `${field} has ${items.length} items`);
  },
);

Then('every stored questions[].star_adherence is between 0 and 1', async function (this: AiWorld) {
  const payload = await storedPayload(this);
  for (const q of payload.questions) {
    assert.ok(q.star_adherence >= 0 && q.star_adherence <= 1, `star_adherence ${q.star_adherence}`);
  }
  for (const row of await prisma.reportQuestion.findMany({
    where: { report: { interview_id: this.interviewId } },
  })) {
    const value = row.star_adherence.toNumber();
    assert.ok(value >= 0 && value <= 1, `report_questions.star_adherence ${value}`);
  }
});
