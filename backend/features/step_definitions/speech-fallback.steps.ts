/**
 * `speech_fallback.feature` @AC-7 — the voice → text downgrade (V03, kept by S05).
 *
 * Driven entirely through `FakeSpeechProvider`: the fatal signal is a `speak()` that throws on
 * the TTS route, which is the one speech failure the server observes for itself (§3.8). The
 * mint it used to be driven by is gone (ADR-S01). No network.
 */
import assert from 'node:assert/strict';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';

import { FakeSpeechProvider } from '../../modules/speech/fake-speech';
import { setSpeechProvider } from '../../modules/speech/SpeechProvider';
import { prisma } from '../../src/lib/db';
import { config } from '../../src/lib/env';
import { logger } from '../../src/lib/logger';
import { setStorage } from '../../src/lib/storage';

import { makeFakeStorage } from '../fixtures/fake-storage';
import { questionIdAt } from './answers.steps';
import { signIn } from './interview-generation.steps';
import { serverState } from './server';
import { AiWorld } from './world';

// target 8 → hr 3 (setup.ts split), so question 3 is the last HR question: the downgrade and
// the answer that follows it both happen inside one round, and `mode` is the only thing that
// changed between them.
const TOTAL_QUESTIONS = 8;

const realInfo = logger.info;

let fake: FakeSpeechProvider;

// ponytail: third copy of this patch (report-run.steps `captureWarnings`, ai-provider.steps).
// Extract to one step-definition helper when a fourth ring needs it.
Before({ tags: '@speech-fallback' }, function (this: AiWorld) {
  fake = new FakeSpeechProvider();
  setSpeechProvider(fake);
  // The TTS route caches through `storage`; the fake keeps the ring off the real bucket and
  // guarantees the healthy scenario is a genuine provider call rather than a cache hit.
  setStorage(makeFakeStorage());
  this.resetEvents();
  captureInfo(this);
});

/** `VOICE_DOWNGRADED_TO_TEXT` is the only event this feature asserts, and it is info-level. */
function captureInfo(world: AiWorld): void {
  logger.info = function capturedInfo(obj: unknown, msg?: string) {
    if (typeof msg === 'string') {
      world.events.push({ level: 'info', event: msg, fields: obj as Record<string, unknown> });
    }
    return realInfo.call(logger, obj as object, msg);
  } as typeof logger.info;
}

After({ tags: '@speech-fallback' }, function () {
  logger.info = realInfo;
});

// ---------------------------------------------------------------- helpers

async function interviewRow(world: AiWorld) {
  return prisma.interview.findUniqueOrThrow({ where: { id: world.interviewId } });
}

async function answerFor(world: AiWorld, index: number) {
  return prisma.answer.findFirst({ where: { question_id: await questionIdAt(world, index) } });
}

// ---------------------------------------------------------------- given

/**
 * Parks a voice-mode interview on `index`, answering everything before it **by voice** — the
 * only way a voice interview honestly arrives at question 3. That matters for the assertion
 * later on: "the answers are preserved with input_mode voice" is vacuous if the fixture wrote
 * them as text, so the next step states the precondition out loud and checks it.
 */
Given(
  'I am in an interview in voice mode on question {int}',
  async function (this: AiWorld, index: number) {
    if (!this.candidateId) await signIn.call(this, 'candidate');

    await this.httpPost('/interviews', {
      mode: 'voice',
      jobText: 'Voice interview position — backend developer, remote.',
      targetQuestionCount: TOTAL_QUESTIONS,
    });
    assert.equal(this.lastStatus, 201, `setup failed: ${JSON.stringify(this.lastBody)}`);
    this.interviewId = (this.lastBody?.interviewId as string | undefined) ?? '';

    await this.httpPost(`/interviews/${this.interviewId}/profile`, { skip: true });
    assert.equal(this.lastStatus, 200, `profile failed: ${JSON.stringify(this.lastBody)}`);

    for (let i = 1; i < index; i++) {
      // The GET is what delivers the question and stamps `asked_at`, exactly as a room does.
      await this.httpGet(`/interviews/${this.interviewId}/state`);
      await this.httpPost(`/interviews/${this.interviewId}/answers`, {
        questionId: await questionIdAt(this, i),
        transcript: `A spoken answer to question ${i}.`,
        inputMode: 'voice',
      });
      assert.equal(this.lastStatus, 200, `answer ${i} failed: ${JSON.stringify(this.lastBody)}`);
    }
    await this.httpGet(`/interviews/${this.interviewId}/state`);

    const interview = await interviewRow(this);
    assert.equal(interview.current_index, index);
    assert.equal(interview.mode, 'voice');
  },
);

Given(
  'I answered questions {int} and {int} by voice',
  async function (this: AiWorld, first: number, second: number) {
    for (const index of [first, second]) {
      const answer = await answerFor(this, index);
      assert.ok(answer, `no answer row for question ${index}`);
      assert.equal(answer.input_mode, 'voice');
    }
  },
);

// ---------------------------------------------------------------- when

/** The room asks for the current question's audio; `failNext()` makes that `speak()` throw. */
async function getCurrentQuestionSpeech(world: AiWorld): Promise<void> {
  const { current_index } = await interviewRow(world);
  await world.httpGet(`/interviews/${world.interviewId}/questions/${current_index}/speech`);
}

When('the fake speech provider reports a fatal error', async function (this: AiWorld) {
  fake.failNext();

  this.resetEvents();
  await getCurrentQuestionSpeech(this);
  assert.equal(this.lastStatus, 503, `expected VOICE_UNAVAILABLE: ${JSON.stringify(this.lastBody)}`);
});

async function postTurnAudio(world: AiWorld): Promise<void> {
  const form = new FormData();
  const bytes = Buffer.from('fake-audio-bytes-for-one-turn');
  form.append(
    'audio',
    new Blob([Uint8Array.from(bytes)], { type: 'audio/webm' }),
    'turn.webm',
  );

  const res = await fetch(`${serverState.baseUrl}/interviews/${world.interviewId}/turns/audio`, {
    method: 'POST',
    headers: {
      origin: config.PUBLIC_ORIGIN,
      ...(world.cookie ? { cookie: world.cookie } : {}),
    },
    body: form,
  });
  world.lastStatus = res.status;
  world.lastBody = await res.json().catch(() => undefined);
}

When('the fake speech provider fails the next transcription', async function (this: AiWorld) {
  fake.failNext();

  this.resetEvents();
  await postTurnAudio(this);
  assert.equal(this.lastStatus, 503, `expected VOICE_UNAVAILABLE: ${JSON.stringify(this.lastBody)}`);
});

When('the fake speech provider serves a question without error', async function (this: AiWorld) {
  this.resetEvents();
  await getCurrentQuestionSpeech(this);
  assert.equal(this.lastStatus, 200, `speech failed: ${JSON.stringify(this.lastBody)}`);
});

/**
 * S07's trigger: the browser could not get a microphone, so the room is never entered and the
 * client posts the V03 downgrade instead. `resetEvents` so the emitted event is this call's.
 */
When('the candidate cannot grant a microphone at pre-join', async function (this: AiWorld) {
  this.resetEvents();
  await this.httpPost(`/interviews/${this.interviewId}/voice/downgrade`, {});
});

/**
 * The downgrade is one-directional (§3.8): the speech route is `voice`-only, so asking it for
 * audio from `text` is an illegal transition, not a transient outage. Same assertion the mint
 * carried before ADR-S01 removed it.
 */
When('I request the current question speech after the downgrade', async function (this: AiWorld) {
  await getCurrentQuestionSpeech(this);
});

// ---------------------------------------------------------------- then

// `the response status is {int}` (ai-provider.steps), `the response error code is {string}`
// (interview-setup.steps), `the interview currentIndex is {int}` (answers.steps) and
// `no {string} event is emitted` (prompt-builder.steps) are already global over AiWorld and
// mean exactly what this feature means. Redefining any of them is an ambiguous-step failure.

// S05: moved here from the deleted voice ring's step definitions. This is now its only
// consumer.
Then(
  'a {string} event is emitted with the interviewId',
  function (this: AiWorld, event: string) {
    const captured = this.eventsNamed(event);
    assert.ok(captured.length > 0, `no ${event} event captured`);
    assert.ok(
      captured.some((e) => e.fields.interviewId === this.interviewId),
      `${event} carried no interviewId: ${JSON.stringify(captured)}`,
    );
  },
);

// Scoped to `provider: 'elevenlabs'`: question generation has already billed its own rows by
// the time an interview exists, so "no llm_calls at all" would assert the wrong thing.
Then('no elevenlabs llm_calls row exists for the interview', async function (this: AiWorld) {
  const rows = await prisma.llmCall.findMany({
    where: { interview_id: this.interviewId, provider: 'elevenlabs' },
  });
  assert.equal(rows.length, 0, `expected no elevenlabs spend, got ${rows.map((r) => r.model).join(', ')}`);
});

Then('the interview mode becomes {string}', async function (this: AiWorld, mode: string) {
  assert.equal((await interviewRow(this)).mode, mode);
});

Then('the interview mode is still {string}', async function (this: AiWorld, mode: string) {
  assert.equal((await interviewRow(this)).mode, mode);
});

Then(
  'the answers for questions {int} and {int} are preserved with input_mode {string}',
  async function (this: AiWorld, first: number, second: number, mode: string) {
    for (const index of [first, second]) {
      const answer = await answerFor(this, index);
      assert.ok(answer, `answer for question ${index} was lost by the downgrade`);
      assert.equal(answer.input_mode, mode);
    }
  },
);

Then(
  'the stored answer for question {int} has input_mode {string}',
  async function (this: AiWorld, index: number, mode: string) {
    const answer = await answerFor(this, index);
    assert.ok(answer, `no answer row for question ${index}`);
    assert.equal(answer.input_mode, mode);
  },
);
