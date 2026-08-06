import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';

import type { Interview } from '@prisma/client';

import { clock } from '../../src/lib/clock';
import { config } from '../../src/lib/env';
import { prisma } from '../../src/lib/db';
import { FakeVoiceSession } from '../../modules/voice/fake-session';
import { ElevenLabsSession } from '../../modules/voice/elevenlabs-session';
import { voiceSeam, setVoiceSession } from '../../modules/voice/session';

import { signIn } from './interview-generation.steps';
import { AiWorld } from './world';

// Save production defaults so After hooks can restore them.
const prodRoundRemaining = voiceSeam.roundRemainingSeconds.bind(voiceSeam);
const prodInterviewRemaining = voiceSeam.interviewRemainingSeconds.bind(voiceSeam);

Before({ tags: '@voice' }, function (this: AiWorld) {
  setVoiceSession(new FakeVoiceSession());
  voiceSeam.aiEnabled = true;
  voiceSeam.roundRemainingSeconds = prodRoundRemaining;
  voiceSeam.interviewRemainingSeconds = prodInterviewRemaining;
});

After({ tags: '@voice' }, function (this: AiWorld) {
  setVoiceSession(new ElevenLabsSession());
  voiceSeam.aiEnabled = config.AI_ENABLED;
  voiceSeam.roundRemainingSeconds = prodRoundRemaining;
  voiceSeam.interviewRemainingSeconds = prodInterviewRemaining;
});

/** Create a voice-mode interview in hr_round for the currently signed-in user. */
async function createVoiceCapableInterview(world: AiWorld): Promise<void> {
  await world.httpPost('/interviews', {
    mode: 'voice',
    jobText: 'Voice interview test position — backend developer.',
    targetQuestionCount: 4,
  });
  assert.equal(world.lastStatus, 201, `interview create failed: ${JSON.stringify(world.lastBody)}`);
  world.interviewId = (world.lastBody?.interviewId as string | undefined) ?? '';
  // Bypass the full profile+generation flow; move directly to hr_round for the voice seam test.
  await prisma.interview.update({
    where: { id: world.interviewId },
    data: { state: 'hr_round', started_at: clock.now() },
  });
}

// ---------------------------------------------------------------- given

Given('I own an interview in a state that can host a voice round', async function (this: AiWorld) {
  if (!this.candidateId) await signIn.call(this, 'candidate');
  await createVoiceCapableInterview(this);
});

Given(
  '{int} seconds remain on the round voice ceiling',
  function (this: AiWorld, seconds: number) {
    voiceSeam.roundRemainingSeconds = (_: Interview) => seconds;
  },
);

Given(
  '{int} seconds remain on the interview voice ceiling',
  function (this: AiWorld, seconds: number) {
    voiceSeam.interviewRemainingSeconds = (_: Interview) => seconds;
  },
);

// Precondition 3 has embedded double quotes (AI_ENABLED "false") so Cucumber cannot parse
// it with {string} — it needs a separate literal step (see voice_session.feature @AC-2).
Given(
  'the precondition "the owner targets a voice-capable interview with AI_ENABLED {string}" holds',
  async function (this: AiWorld, aiEnabledValue: string) {
    if (!this.candidateId) await signIn.call(this, 'candidate');
    await createVoiceCapableInterview(this);
    voiceSeam.aiEnabled = aiEnabledValue === 'true';
  },
);

Given(
  'the precondition {string} holds',
  async function (this: AiWorld, precondition: string) {
    switch (precondition) {
      case 'a non-owner targets another candidate\'s voice-capable interview': {
        // Sign in as the owner and create the interview.
        await signIn.call(this, 'owner');
        await createVoiceCapableInterview(this);
        const targetId = this.interviewId;
        // Sign in as a different user — this.cookie now belongs to the non-owner.
        const nonOwnerEmail = `non-owner-${randomUUID()}@example.com`;
        await this.httpPost('/auth/register', {
          email: nonOwnerEmail,
          password: 'correct-horse-battery',
          consent: true,
        });
        assert.equal(this.lastStatus, 201, `non-owner register failed: ${JSON.stringify(this.lastBody)}`);
        // Keep the owner's interview id; the cookie is the non-owner's.
        this.interviewId = targetId;
        break;
      }
      case 'the owner targets an interview in a state that cannot host voice': {
        if (!this.candidateId) await signIn.call(this, 'candidate');
        await this.httpPost('/interviews', {
          mode: 'voice',
          jobText: 'Voice interview test position.',
          targetQuestionCount: 4,
        });
        assert.equal(this.lastStatus, 201);
        this.interviewId = (this.lastBody?.interviewId as string | undefined) ?? '';
        // evaluating is not voice-capable.
        await prisma.interview.update({
          where: { id: this.interviewId },
          data: { state: 'evaluating' },
        });
        break;
      }
      default:
        throw new Error(`Unknown precondition: ${precondition}`);
    }
  },
);

// ---------------------------------------------------------------- when

function resolveVoicePath(path: string, interviewId: string): string {
  // Strip optional "METHOD " prefix (e.g. "POST /interviews/:id/voice/session")
  return path.replace(/^[A-Z]+\s+/, '').replace(':id', interviewId);
}

When('I POST {string}', async function (this: AiWorld, path: string) {
  await this.httpPost(resolveVoicePath(path, this.interviewId), {});
});

When(
  'the mint is attempted with {string}',
  async function (this: AiWorld, path: string) {
    await this.httpPost(resolveVoicePath(path, this.interviewId), {});
  },
);

// ---------------------------------------------------------------- then

Then('the response contains a session token and a wssOrigin', function (this: AiWorld) {
  const body = this.lastBody as Record<string, unknown> | undefined;
  assert.ok(typeof body?.token === 'string' && body.token.length > 0, `token missing: ${JSON.stringify(body)}`);
  assert.ok(typeof body?.wssOrigin === 'string' && body.wssOrigin.length > 0, `wssOrigin missing: ${JSON.stringify(body)}`);
});

Then('the response dynamicVars are the interviewId and a nonce', function (this: AiWorld) {
  const body = this.lastBody as Record<string, unknown> | undefined;
  const dv = body?.dynamicVars as Record<string, unknown> | undefined;
  assert.equal(dv?.interviewId, this.interviewId, `dynamicVars.interviewId wrong: ${JSON.stringify(dv)}`);
  assert.ok(typeof dv?.nonce === 'string' && dv.nonce.length === 64, `nonce wrong (expect 64-char hex): ${JSON.stringify(dv)}`);
});

Then(
  'a voice_sessions row exists with expires_at {int} seconds ahead of the fixed clock',
  async function (this: AiWorld, seconds: number) {
    const row = await prisma.voiceSession.findFirst({
      where: { interview_id: this.interviewId },
      orderBy: { expires_at: 'desc' },
    });
    assert.ok(row, 'no voice_sessions row found');
    const expected = new Date(clock.now().getTime() + seconds * 1000);
    assert.equal(
      row.expires_at.toISOString(),
      expected.toISOString(),
      `expires_at mismatch: got ${row.expires_at.toISOString()}, want ${expected.toISOString()}`,
    );
  },
);

Then('the response contains no ElevenLabs API key', function (this: AiWorld) {
  const raw = JSON.stringify(this.lastBody);
  const key = config.ELEVENLABS_API_KEY;
  if (key) assert.ok(!raw.includes(key), 'API key found in response payload');
  // Also verify the static marker text is not present.
  assert.ok(!raw.includes('ELEVENLABS_API_KEY'), 'ELEVENLABS_API_KEY string found in response');
});

Then('no voice_sessions row is written', async function (this: AiWorld) {
  const count = await prisma.voiceSession.count({ where: { interview_id: this.interviewId } });
  assert.equal(count, 0, `expected 0 voice_sessions rows, found ${count}`);
});

Then('a voice_sessions row is written for the interview', async function (this: AiWorld) {
  const count = await prisma.voiceSession.count({ where: { interview_id: this.interviewId } });
  assert.equal(count, 1, `expected 1 voice_sessions row, found ${count}`);
});
