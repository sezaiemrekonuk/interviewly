/**
 * `speech_turn.feature` @AC-1 / @AC-3 — seam-level scenarios.
 * Tests `SpeechProvider` interface contract via `FakeSpeechProvider`. No HTTP, no network.
 */
import assert from 'node:assert/strict';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';

import { ApiError } from '../../src/lib/api-error';
import { FakeSpeechProvider } from '../../modules/speech/fake-speech';
import { setSpeechProvider, speechProvider } from '../../modules/speech/SpeechProvider';

import { AiWorld } from './world';

let fake: FakeSpeechProvider;
let speakResult: { audio: Buffer; mime: string; characters: number } | undefined;
let transcribeResult: { transcript: string; seconds: number } | undefined;
let thrownError: unknown;
let lastSpeakText: string;

Before({ tags: '@speech' }, function () {
  fake = new FakeSpeechProvider();
  setSpeechProvider(fake);
  speakResult = undefined;
  transcribeResult = undefined;
  thrownError = undefined;
  lastSpeakText = '';
});

After({ tags: '@speech' }, function () {
  // restore the real provider — ElevenLabsSpeech is the default; re-importing would re-create
  // it. The Before hook replaces it each scenario, so no restore is strictly needed, but
  // explicitly clearing state guards against scenario ordering assumptions.
  speakResult = undefined;
  transcribeResult = undefined;
  thrownError = undefined;
});

// ---------------------------------------------------------------- given

Given('the fake speech provider is installed', function (this: AiWorld) {
  // done in Before hook; this step exists so the Background reads naturally
});

Given('failNext is set on the fake speech provider', function (this: AiWorld) {
  fake.failNext();
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
