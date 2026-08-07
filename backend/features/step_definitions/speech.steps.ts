/**
 * `speech_turn.feature` @AC-1 / @AC-3 — seam-level scenarios.
 * Tests `SpeechProvider` interface contract via `FakeSpeechProvider`. No HTTP, no network.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { config } from '../../src/lib/env';
import { setStorage } from '../../src/lib/storage';
import { FakeSpeechProvider } from '../../modules/speech/fake-speech';
import { setSpeechProvider, speechProvider } from '../../modules/speech/SpeechProvider';
import { signIn } from './interview-generation.steps';
import { makeFakeStorage } from '../fixtures/fake-storage';
import { serverState } from './server';

import { AiWorld } from './world';

let fake: FakeSpeechProvider;
let speakResult: { audio: Buffer; mime: string; characters: number } | undefined;
let transcribeResult: { transcript: string; seconds: number } | undefined;
let thrownError: unknown;
let lastSpeakText: string;
let lastAudioBody: Buffer | undefined;
let lastContentType = '';
let otherInterviewId = '';
let fakeStorage = makeFakeStorage();

Before({ tags: '@speech' }, function () {
  fake = new FakeSpeechProvider();
  fakeStorage = makeFakeStorage();
  setSpeechProvider(fake);
  setStorage(fakeStorage);
  speakResult = undefined;
  transcribeResult = undefined;
  thrownError = undefined;
  lastSpeakText = '';
  lastAudioBody = undefined;
  lastContentType = '';
  otherInterviewId = '';
});

After({ tags: '@speech' }, function () {
  // restore the real provider — ElevenLabsSpeech is the default; re-importing would re-create
  // it. The Before hook replaces it each scenario, so no restore is strictly needed, but
  // explicitly clearing state guards against scenario ordering assumptions.
  speakResult = undefined;
  transcribeResult = undefined;
  thrownError = undefined;
  lastAudioBody = undefined;
  lastContentType = '';
});

async function createVoiceInterview(world: AiWorld): Promise<void> {
  await world.httpPost('/interviews', {
    mode: 'voice',
    jobText: 'Speech route test role.',
    targetQuestionCount: 4,
  });
  assert.equal(world.lastStatus, 201, `setup failed: ${JSON.stringify(world.lastBody)}`);
  world.interviewId = (world.lastBody?.interviewId as string | undefined) ?? '';

  const interview = await prisma.interview.findUniqueOrThrow({ where: { id: world.interviewId } });
  await prisma.interview.update({
    where: { id: world.interviewId },
    data: {
      mode: 'voice',
      state: 'hr_round',
      started_at: new Date(),
      current_index: 1,
      hr_question_count: 2,
    },
  });

  const hrPersona = await prisma.persona.findFirstOrThrow({ where: { role: 'hr', active: true } });
  const hrRound = await prisma.interviewRound.upsert({
    where: { interview_id_type: { interview_id: world.interviewId, type: 'hr' } },
    update: { persona_id: hrPersona.id },
    create: {
      interview_id: world.interviewId,
      type: 'hr',
      status: 'active',
      persona_id: hrPersona.id,
    },
  });

  const existing = await prisma.question.findFirst({
    where: { round: { interview_id: world.interviewId, type: 'hr' }, order_index: 1 },
  });
  if (!existing) {
    await prisma.question.create({
      data: {
        id: `q-${randomUUID()}`,
        round_id: hrRound.id,
        order_index: 1,
        text: 'Tell me about your experience with backend systems.',
        kind: 'open',
        difficulty: 'easy',
        topic: 'backend-experience',
      },
    });
  }

  // keep mutable copy in sync with DB row updates done by handlers.
  interview.mode = 'voice';
}

function resolveSpeechPath(path: string, interviewId: string): string {
  return path.replace(':id', interviewId).replace(':index', '1');
}

// ---------------------------------------------------------------- given

Given('the fake speech provider is installed', function (this: AiWorld) {
  // done in Before hook; this step exists so the Background reads naturally
});

Given('failNext is set on the fake speech provider', function (this: AiWorld) {
  fake.failNext();
});

Given('the fake speech provider returns an empty transcript next', function (this: AiWorld) {
  fake.transcribeEmptyNext();
});

Given('I am signed in as a speech candidate', async function (this: AiWorld) {
  if (!this.candidateId) await signIn.call(this, 'speech-candidate');
});

Given('I have a voice interview in hr_round with current index 1', async function (this: AiWorld) {
  await createVoiceInterview(this);
});

Given('another candidate owns a voice interview in hr_round with current index 1', async function (this: AiWorld) {
  await signIn.call(this, 'speech-owner');
  await createVoiceInterview(this);
  otherInterviewId = this.interviewId;

  const nonOwnerEmail = `speech-non-owner-${randomUUID()}@example.com`;
  await this.httpPost('/auth/register', {
    email: nonOwnerEmail,
    password: 'correct-horse-battery',
    consent: true,
  });
  assert.equal(this.lastStatus, 201, `non-owner register failed: ${JSON.stringify(this.lastBody)}`);
  this.interviewId = otherInterviewId;
});

Given('that interview started {int} seconds ago', async function (this: AiWorld, seconds: number) {
  await prisma.interview.update({
    where: { id: this.interviewId },
    data: { started_at: new Date(Date.now() - seconds * 1000) },
  });
});

// ---------------------------------------------------------------- when

When(
  'I call speak with text {string} voiceId {string} language {string}',
  async function (this: AiWorld, text: string, voiceId: string, language: string) {
    lastSpeakText = text;
    speakResult = await speechProvider.speak(text, { voiceId, language });
  },
);

When(
  'I attempt to call speak with text {string} voiceId {string} language {string}',
  async function (this: AiWorld, text: string, voiceId: string, language: string) {
    lastSpeakText = text;
    try {
      speakResult = await speechProvider.speak(text, { voiceId, language });
    } catch (err) {
      thrownError = err;
    }
  },
);

When(
  'I call transcribe with {int} bytes of mime {string} language {string}',
  async function (this: AiWorld, byteCount: number, mime: string, language: string) {
    const audio = Buffer.alloc(byteCount, 0x00);
    transcribeResult = await speechProvider.transcribe(audio, { mime, language });
  },
);

When('I GET {string} as that owner', async function (this: AiWorld, path: string) {
  const res = await fetch(`${serverState.baseUrl}${resolveSpeechPath(path, this.interviewId)}`, {
    headers: this.cookie ? { cookie: this.cookie } : {},
  });
  this.lastStatus = res.status;
  const body = Buffer.from(await res.arrayBuffer());
  lastAudioBody = body;
  lastContentType = res.headers.get('content-type') ?? '';
  const contentType = res.headers.get('content-type') ?? '';
  this.lastBody = contentType.includes('application/json')
    ? JSON.parse(body.toString('utf8'))
    : undefined;
});

When('I GET {string} as a non-owner', async function (this: AiWorld, path: string) {
  const res = await fetch(`${serverState.baseUrl}${resolveSpeechPath(path, this.interviewId)}`, {
    headers: this.cookie ? { cookie: this.cookie } : {},
  });
  this.lastStatus = res.status;
  const body = Buffer.from(await res.arrayBuffer());
  lastAudioBody = body;
  lastContentType = res.headers.get('content-type') ?? '';
  const contentType = res.headers.get('content-type') ?? '';
  this.lastBody = contentType.includes('application/json')
    ? JSON.parse(body.toString('utf8'))
    : undefined;
});

// ---------------------------------------------------------------- then

Then('the audio mime is {string}', function (this: AiWorld, expected: string) {
  assert.ok(speakResult, 'no speak result');
  assert.equal(speakResult.mime, expected);
});

Then('the audio buffer is non-empty', function (this: AiWorld) {
  assert.ok(speakResult, 'no speak result');
  assert.ok(speakResult.audio.length > 0, 'audio buffer is empty');
});

Then('the character count equals the length of the spoken text', function (this: AiWorld) {
  assert.ok(speakResult, 'no speak result');
  assert.equal(speakResult.characters, lastSpeakText.length);
});

Then('the transcript is a non-empty string', function (this: AiWorld) {
  assert.ok(transcribeResult, 'no transcribe result');
  assert.ok(transcribeResult.transcript.length > 0, 'transcript is empty');
});

Then('the seconds count is positive', function (this: AiWorld) {
  assert.ok(transcribeResult, 'no transcribe result');
  assert.ok(transcribeResult.seconds > 0, `seconds is not positive: ${transcribeResult.seconds}`);
});

Then(
  'the speak call throws an ApiError with code {string}',
  function (this: AiWorld, code: string) {
    assert.ok(thrownError instanceof ApiError, `expected ApiError, got ${thrownError}`);
    assert.equal(thrownError.code, code);
  },
);

Then('the response is {string} bytes', function (this: AiWorld, mime: string) {
  assert.ok(lastContentType.includes(mime), `expected content-type to include ${mime}, got ${lastContentType}`);
  assert.ok(lastAudioBody && lastAudioBody.length > 0, 'expected non-empty audio body');
});

Then('the speech response body does not include the ElevenLabs API key material', function (this: AiWorld) {
  const raw = lastAudioBody ? lastAudioBody.toString('utf8') : '';
  assert.ok(!raw.includes('ELEVENLABS_API_KEY'), 'ELEVENLABS_API_KEY marker found in body');
});

Then('the API response code is {string}', function (this: AiWorld, code: string) {
  const body = this.lastBody as { error?: { code?: string } } | undefined;
  assert.equal(body?.error?.code, code, `expected code ${code}: ${JSON.stringify(this.lastBody)}`);
});

Then('the fake speech provider speak call count is {int}', function (this: AiWorld, count: number) {
  assert.equal(fake.speakCalls, count, `expected ${count} speak calls, got ${fake.speakCalls}`);
});

Then('that interview ended reason is {string}', async function (this: AiWorld, endedReason: string) {
  const row = await prisma.interview.findUniqueOrThrow({ where: { id: this.interviewId } });
  assert.equal(row.ended_reason, endedReason);
});

// ---------------------------------------------------------------- S03: STT answer route

async function currentQuestionId(interviewId: string): Promise<string> {
  const row = await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } });
  const question = await prisma.question.findFirstOrThrow({
    where: { round: { interview_id: interviewId }, order_index: row.current_index },
  });
  return question.id;
}

async function postAnswerAudio(
  world: AiWorld,
  mime: string,
  bytes: Buffer,
  questionId?: string,
): Promise<void> {
  const form = new FormData();
  form.append('questionId', questionId ?? (await currentQuestionId(world.interviewId)));
  form.append('audio', new Blob([new Uint8Array(bytes)], { type: mime }), 'answer.webm');
  const res = await fetch(`${serverState.baseUrl}/interviews/${world.interviewId}/answers/audio`, {
    method: 'POST',
    headers: {
      origin: config.PUBLIC_ORIGIN,
      ...(world.cookie ? { cookie: world.cookie } : {}),
    },
    body: form,
  });
  world.lastStatus = res.status;
  const contentType = res.headers.get('content-type') ?? '';
  world.lastBody = contentType.includes('application/json')
    ? ((await res.json()) as Record<string, unknown>)
    : undefined;
}

async function countAnswers(interviewId: string, inputMode?: string): Promise<number> {
  return prisma.answer.count({
    where: {
      question: { round: { interview_id: interviewId } },
      ...(inputMode ? { input_mode: inputMode as never } : {}),
    },
  });
}

When('I POST a {string} answer recording as that owner', async function (this: AiWorld, mime: string) {
  await postAnswerAudio(this, mime, Buffer.from('fake-audio-bytes-for-one-answer'));
});

When(
  'I POST a {string} answer recording naming a stale question as that owner',
  async function (this: AiWorld, mime: string) {
    await postAnswerAudio(
      this,
      mime,
      Buffer.from('fake-audio-bytes-for-one-answer'),
      'q-stale-not-current',
    );
  },
);

When(
  'I POST an oversize {string} answer recording as that owner',
  async function (this: AiWorld, mime: string) {
    // 10 MiB cap + slack + 1 — trips the Content-Length precheck before any byte is buffered.
    await postAnswerAudio(this, mime, Buffer.alloc(10 * 1024 * 1024 + 4096 + 1, 0x61));
  },
);

Then('the answer response status is {int}', function (this: AiWorld, status: number) {
  assert.equal(this.lastStatus, status, `expected ${status}: ${JSON.stringify(this.lastBody)}`);
});

Then(
  'the interview holds exactly {int} answer with input mode {string}',
  async function (this: AiWorld, count: number, mode: string) {
    assert.equal(await countAnswers(this.interviewId, mode), count);
  },
);

Then('the interview holds exactly {int} answers', async function (this: AiWorld, count: number) {
  assert.equal(await countAnswers(this.interviewId), count);
});

Then('the interview current index is {int}', async function (this: AiWorld, index: number) {
  const row = await prisma.interview.findUniqueOrThrow({ where: { id: this.interviewId } });
  assert.equal(row.current_index, index);
});

Then(
  'the fake speech provider transcribe call count is {int}',
  function (this: AiWorld, count: number) {
    assert.equal(fake.transcribeCalls, count, `expected ${count} transcribe calls, got ${fake.transcribeCalls}`);
  },
);

Then('the fake storage holds no audio object', function (this: AiWorld) {
  assert.deepEqual(fakeStorage.keys(), [], `expected empty storage, got ${fakeStorage.keys().join(', ')}`);
});

// ---------------------------------------------------------------- S04: per-call usage accounting

Then(
  'the interview has exactly {int} elevenlabs llm_calls row for model {string} with unit kind {string}',
  async function (this: AiWorld, count: number, model: string, unitKind: string) {
    const rows = await prisma.llmCall.findMany({
      where: { interview_id: this.interviewId, provider: 'elevenlabs', model },
    });
    assert.equal(rows.length, count, `expected ${count} elevenlabs/${model} rows, got ${rows.length}`);
    for (const row of rows) assert.equal(row.unit_kind, unitKind, `unexpected unit_kind ${row.unit_kind}`);
  },
);

Then('the interview spent_usd is greater than zero', async function (this: AiWorld) {
  const row = await prisma.interview.findUniqueOrThrow({ where: { id: this.interviewId } });
  assert.ok(Number(row.spent_usd) > 0, `spent_usd not positive: ${row.spent_usd.toString()}`);
});
