/**
 * `adaptive_questions.feature` @AC-12 — the K4 score-driven promotion (D03).
 *
 * The stub `scoreAnswer` returns a fixed, self-valid score, so it can neither vary the score
 * nor emit a malformed one. The score is instead injected: `advanceWithAnswer` is called
 * directly with a client whose `scoreAnswer` returns exactly the score the row under test
 * needs — valid 0..5 for the graded outline, out-of-range for the malformed scenario. This is
 * the module-level seam ADR-D03/@AC-1 already use when HTTP cannot configure the AI.
 *
 * The interview is parked on a *technical* question (index 5 of 8), so submitting it fires no
 * HR→tech handover and no batch generation — the only side-effect on the turn is the hook.
 * Its next row (index 6) is seeded with three controlled candidates, the D02 pre-generation
 * this task consumes; an un-seeded row is the MVP path the hook leaves untouched.
 */
import assert from 'node:assert/strict';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { CandidateSchema, ScoresSchema, type AiClient, type Scores } from '@interviewly/ai';
import type { Difficulty } from '@prisma/client';
import { z } from 'zod';

import { aiClient } from '../../modules/ai';
import { advanceWithAnswer } from '../../modules/interview/answers';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

import { arriveAtQuestion, questionIdAt } from './answers.steps';
import { AiWorld } from './world';

const TOTAL = 8;
const CURRENT_INDEX = 5; // a tech-round question: its submit fires no handover, only the hook.
const NEXT_INDEX = 6;

// The D02 candidates seeded on the next row. One at each difficulty so the selector always
// finds a match: same-topic for easier/same moves, a new topic for the harder move.
const CONTROLLED_CANDIDATES = [
  { text: 'An easier follow-up on the same area.', difficulty: 'easy', topic: 'sql-indexes' },
  { text: 'A same-level angle on the same area.', difficulty: 'medium', topic: 'sql-indexes' },
  { text: 'A harder question on a new area.', difficulty: 'hard', topic: 'system-design' },
];

// Scenario-local — cucumber runs these serially (mirrors answers.steps).
let configuredScore: Scores;
let currentTopic = '';
/** The next row's text as I06 generated it, so a promotion can be told from a no-op. */
let defaultNextText = '';

/** A schema-valid score whose `overall` drives the selector; the rest is filler for the report. */
function validScore(overall: number): Scores {
  return { overall, relevance: overall, depth: overall, structure: overall, star_adherence: 0.8, reasons: ['reason'] };
}

/**
 * The configured score over the real client, delegating everything else.
 *
 * Spreading the client (`{ ...aiClient(), scoreAnswer }`) does not work here: it is a class
 * instance, so its methods live on the prototype and an object spread copies none of them.
 * That was harmless while the hook called nothing but `scoreAnswer`; now that it also
 * pre-generates, a spread client is one `generateCandidates is not a function` away.
 */
function clientScoring(score: () => Scores): AiClient {
  const real = aiClient();
  return {
    generateRoundQuestions: (args) => real.generateRoundQuestions(args),
    generateReport: (args) => real.generateReport(args),
    generateCandidates: (args) => real.generateCandidates(args),
    generateInterviewTitle: (args) => real.generateInterviewTitle(args),
    detectLanguage: (text, current) => real.detectLanguage(text, current),
    scoreAnswer: async () => score(),
  };
}

const realInfo = logger.info;
const realWarn = logger.warn;

// The hook logs ADAPTIVE_QUESTION_PROMOTED (info) and LLM_FALLBACK_TRIGGERED (warn); both are
// captured so the shared event step in ai-provider.steps can read them off the World.
function captureLogs(world: AiWorld): void {
  logger.info = function capturedInfo(obj: unknown, msg?: string) {
    if (typeof msg === 'string') world.events.push({ level: 'info', event: msg, fields: obj as Record<string, unknown> });
    return realInfo.call(logger, obj as object, msg);
  } as typeof logger.info;
  logger.warn = function capturedWarn(obj: unknown, msg?: string) {
    if (typeof msg === 'string') world.events.push({ level: 'warn', event: msg, fields: obj as Record<string, unknown> });
    return realWarn.call(logger, obj as object, msg);
  } as typeof logger.warn;
}

Before({ tags: '@adaptive-questions' }, function (this: AiWorld) {
  this.resetEvents();
  captureLogs(this);
});

After({ tags: '@adaptive-questions' }, function () {
  logger.info = realInfo;
  logger.warn = realWarn;
  currentTopic = '';
});

// ---------------------------------------------------------------- given

async function parkOnQuestion(
  world: AiWorld,
  topic: string,
  difficulty: string,
  seedPool: boolean,
): Promise<void> {
  await arriveAtQuestion(world, CURRENT_INDEX, TOTAL);
  currentTopic = topic;
  await prisma.question.update({
    where: { id: await questionIdAt(world, CURRENT_INDEX) },
    data: { topic, difficulty: difficulty as Difficulty },
  });
  defaultNextText = (
    await prisma.question.findUniqueOrThrow({ where: { id: await questionIdAt(world, NEXT_INDEX) } })
  ).text;
  if (!seedPool) return;
  await prisma.question.update({
    where: { id: await questionIdAt(world, NEXT_INDEX) },
    data: { candidates: CONTROLLED_CANDIDATES },
  });
}

Given(
  'the current question has topic {string} and difficulty {string}',
  async function (this: AiWorld, topic: string, difficulty: string) {
    // Seeded pool: the outline is about the *selection*, so the candidates are controlled
    // rather than whatever the stub would produce.
    await parkOnQuestion(this, topic, difficulty, true);
  },
);

/**
 * The #148 scenario. Seeding the pool is what hid the bug for three tasks — it performed by
 * hand the one step the product had no code to perform — so this one seeds nothing and makes
 * the turn produce its own pool, exactly as a real interview must.
 */
Given(
  'the current question has topic {string} and difficulty {string} and no candidate pool',
  async function (this: AiWorld, topic: string, difficulty: string) {
    await parkOnQuestion(this, topic, difficulty, false);
    const next = await prisma.question.findUniqueOrThrow({
      where: { id: await questionIdAt(this, NEXT_INDEX) },
    });
    assert.equal(next.candidates, null, 'the fixture pre-seeded the pool this scenario must create');
  },
);

Given('the stub AI scores the submitted answer {int}', function (_overall: number) {
  configuredScore = validScore(_overall);
});

Given('the stub AI is configured to return a score with overall {int}', function (overall: number) {
  // Out of the schema's 0..5 range: the selector must treat it as ungraded, never promote it.
  configuredScore = { ...validScore(3), overall };
});

// ---------------------------------------------------------------- when

When('I submit the current answer for adaptive scoring', async function (this: AiWorld) {
  this.resetEvents(); // only this turn's events count toward the assertions below.
  const interview = await prisma.interview.findUniqueOrThrow({ where: { id: this.interviewId } });
  const client = clientScoring(() => configuredScore);
  this.lastStatus = 0;
  this.generateError = undefined;
  try {
    await advanceWithAnswer(
      interview,
      { questionId: await questionIdAt(this, CURRENT_INDEX), transcript: 'An answer to the current question.', inputMode: 'text' },
      { traceId: `trace-${interview.id}`, client },
    );
  } catch (err) {
    this.generateError = err;
  }
});

// ---------------------------------------------------------------- then

async function currentAnswer(world: AiWorld) {
  return prisma.answer.findFirst({ where: { question_id: await questionIdAt(world, CURRENT_INDEX) } });
}

async function nextQuestion(world: AiWorld) {
  return prisma.question.findUniqueOrThrow({ where: { id: await questionIdAt(world, NEXT_INDEX) } });
}

Then('the scored answer validates against the Scores schema', async function (this: AiWorld) {
  const answer = await currentAnswer(this);
  assert.ok(answer?.scores, 'the answer carries no score');
  assert.ok(ScoresSchema.safeParse(answer.scores).success, `score is not schema-valid: ${JSON.stringify(answer.scores)}`);
});

Then('no answer score is handed back', async function (this: AiWorld) {
  const answer = await currentAnswer(this);
  assert.equal(answer?.scores ?? null, null, 'a score was recorded on the malformed path');
});

Then('the next question difficulty is {string}', async function (this: AiWorld, difficulty: string) {
  assert.equal((await nextQuestion(this)).difficulty, difficulty);
});

Then('the next question topic is {string} the current topic', async function (this: AiWorld, relation: string) {
  const sameTopic = (await nextQuestion(this)).topic === currentTopic;
  assert.equal(sameTopic, relation === 'the same as', `expected topic ${relation} "${currentTopic}"`);
});

Then('the next question chosen_reason is {string}', async function (this: AiWorld, reason: string) {
  assert.equal((await nextQuestion(this)).chosen_reason, reason);
});

Then('the next question carries a candidate pool', async function (this: AiWorld) {
  const parsed = z.array(CandidateSchema).safeParse((await nextQuestion(this)).candidates);
  assert.ok(parsed.success, 'the next row carries no schema-valid candidate pool');
  assert.ok(parsed.data.length > 0, 'the candidate pool is empty');
});

Then('the next question is not the one the round generated', async function (this: AiWorld) {
  assert.notEqual((await nextQuestion(this)).text, defaultNextText);
});
