/**
 * `interview_flow.feature` @AC-16 — what `POST /interviews/:id/resume` has to *do* (I07).
 *
 * The transition-table scenario next door proves the `paused → hr_round` edge is legal. These
 * two prove it is useful: the only thing that pauses an interview is a generation that failed
 * before its all-or-nothing insert, so a resume that changes nothing but the state hands the
 * candidate a room with no question and no button left to press.
 *
 * Driven end-to-end through HTTP, unlike @AC-1's module ring: the whole point is that the
 * endpoint a room's Resume button calls leaves the interview answerable. The provider is faked
 * by shadowing the singleton's method — the same seam `the stub AI shorts the next batch`
 * uses, and torn down by the same `After` hook in `interview-generation.steps.ts`.
 */
import assert from 'node:assert/strict';
import { Given, Then, When } from '@cucumber/cucumber';
import type { InterviewState } from '@prisma/client';
import { AiError } from '@interviewly/ai';

import { aiClient } from '../../modules/ai';
import { prisma } from '../../src/lib/db';

import { AiWorld } from './world';

// ---------------------------------------------------------------- given

Given('the AI provider chain is exhausted', function () {
  const client = aiClient();
  client.generateRoundQuestions = async () => {
    throw new AiError('AI_PROVIDER_UNAVAILABLE', 'every provider in the chain failed');
  };
});

// ---------------------------------------------------------------- when

When('I POST {string} to resume the interview', async function (this: AiWorld, _path: string) {
  await this.httpPost(`/interviews/${this.interviewId}/resume`, {});
});

/**
 * The one direct write. Re-pausing an interview whose batch already exists is not something a
 * provider outage can reach — a full round never generates again — and idempotence is exactly
 * the property that has to hold if a second pause source ever lands.
 */
When('the interview is forced back to {string}', async function (this: AiWorld, state: string) {
  await prisma.interview.update({
    where: { id: this.interviewId },
    data: { state: state as InterviewState },
  });
});

// ---------------------------------------------------------------- then

Then('the room\'s current question is HR question {int}', async function (this: AiWorld, n: number) {
  await this.httpGet(`/interviews/${this.interviewId}/state`);
  assert.equal(this.lastStatus, 200, `state failed: ${JSON.stringify(this.lastBody)}`);

  const current = this.lastBody?.currentQuestion as { id?: string } | null | undefined;
  assert.ok(current?.id, 'the room has no current question — it would sit on "preparing…"');

  const expected = await prisma.question.findFirstOrThrow({
    where: { round: { interview_id: this.interviewId, type: 'hr' }, order_index: n },
  });
  assert.equal(current.id, expected.id);
});
