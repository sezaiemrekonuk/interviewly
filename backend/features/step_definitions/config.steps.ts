/**
 * `config.feature` @AC-5 (I15). `the API starts`, `startup fails before serving|serves
 * requests` and `the boot error code is` are shared with `ai_provider.feature` and live in
 * ai-provider.steps.ts, which branches on `envBoot.active` (fixtures/env-boot.ts).
 */
import { strict as assert } from 'node:assert';

import { After, Before, Given, Then, When, setDefaultTimeout } from '@cucumber/cucumber';

import { envBoot, isServing, killApi, reset, validValue } from '../fixtures/env-boot';

// A child API process is a boot, not a function call: 5 s is not enough for tsx + Prisma.
setDefaultTimeout(30_000);

Before({ tags: '@config' }, reset);
After({ tags: '@config' }, killApi);

Given('the required env var {string} is unset', function (key: string) {
  envBoot.overrides[key] = undefined;
});

Given('the required env var {string} is {string}', function (key: string, state: string) {
  if (state === 'unset') envBoot.overrides[key] = undefined;
  else if (state === 'malformed') envBoot.overrides[key] = 'not-a-url';
  else throw new Error(`unknown env state "${state}"`);
});

When('{string} is set to a valid value', function (key: string) {
  envBoot.overrides[key] = validValue(key);
});

When('every required env var is set to a valid value', function () {
  envBoot.overrides = {};
});

When('every other required env var is set to a valid value', function () {
  for (const [key, value] of Object.entries(envBoot.overrides)) {
    if (value === undefined || value === 'not-a-url') delete envBoot.overrides[key];
  }
});

Then('the boot error message names {string}', function (key: string) {
  const { output } = envBoot.result!;
  assert.ok(output.includes(key), `expected ${key} named in the boot error:\n${output}`);
});

Then('no request is served', async function () {
  assert.equal(await isServing(envBoot.result!.port), false);
});

Then('no {string} boot error is raised', function (code: string) {
  const { output } = envBoot.result!;
  assert.ok(!output.includes(code), `unexpected ${code}:\n${output}`);
});
