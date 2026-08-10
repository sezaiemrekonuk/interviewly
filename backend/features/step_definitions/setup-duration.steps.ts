/**
 * `speech_turn.feature` @AC-11 — the voice-first default and the chosen duration (S08).
 *
 * No provider is involved: these scenarios stop at `POST /interviews`, which writes the two
 * columns the ceiling later reads. `I am signed in as a candidate`, `the response status is
 * {int}`, `the response error code is {string}` and `no interview is created` are defined in
 * interview-setup.steps.ts / ai-provider.steps.ts and reused here.
 */
import assert from 'node:assert/strict';
import { Then, When } from '@cucumber/cucumber';

import { prisma } from '../../src/lib/db';

import { AiWorld } from './world';

const LISTING = (role: string) =>
  `${role} — remote, full-time. We are hiring a ${role.toLowerCase()}.`;

async function createInterview(world: AiWorld, body: Record<string, unknown>): Promise<void> {
  await world.httpPost('/interviews', body);
  if (world.lastStatus === 201) {
    world.interviewId = (world.lastBody?.interviewId as string | undefined) ?? '';
  }
}

When(
  'I start an interview with a {string} listing and no mode',
  async function (this: AiWorld, role: string) {
    await createInterview(this, { jobText: LISTING(role), targetQuestionCount: 8 });
  },
);

When(
  'I start a voice interview with a duration of {int} seconds',
  async function (this: AiWorld, durationSeconds: number) {
    await createInterview(this, {
      mode: 'voice',
      jobText: LISTING('Backend Engineer'),
      targetQuestionCount: 8,
      durationSeconds,
    });
  },
);

Then('the interview mode is {string}', async function (this: AiWorld, mode: string) {
  const row = await prisma.interview.findUniqueOrThrow({
    where: { id: this.interviewId },
    select: { mode: true },
  });
  assert.equal(row.mode, mode);
});

Then('the interview max duration is {int} seconds', async function (this: AiWorld, seconds: number) {
  const row = await prisma.interview.findUniqueOrThrow({
    where: { id: this.interviewId },
    select: { max_duration_seconds: true },
  });
  assert.equal(row.max_duration_seconds, seconds);
});
