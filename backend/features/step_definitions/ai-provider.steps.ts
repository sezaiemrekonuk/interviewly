/**
 * `ai_provider.feature` — the fallback chain, the per-attempt audit row, cost, the kill
 * switch and the boot-time key check (I02).
 *
 * The fake sits at `ProviderTransport`, i.e. at the network. Everything above it — the
 * chain, `attempt_no`/`fell_back_from`, the `llm_calls` row, `costFor`, the schema gate — is
 * the real implementation, which is the only arrangement where these assertions mean
 * anything. `AiClient` itself is never faked here.
 *
 * `the HR round is generated` is defined once, in `prompt-builder.steps.ts`, and shared.
 */
import assert from 'node:assert/strict';
import { Given, Then, When } from '@cucumber/cucumber';
import {
  AiError,
  ModelPrices,
  QuestionBatchSchema,
  validateProviderKeys,
} from '@interviewly/ai';
import { AiWorld, type Tier1Outcome } from './world';

const CARDINALITY: Record<string, number> = { one: 1, two: 2 };

function rows(world: AiWorld) {
  return world.llmCalls;
}

/** The boot check, run lazily so a scenario that never mentions startup never triggers one. */
function boot(world: AiWorld): void {
  if (world.boot || world.bootError) return;
  try {
    world.boot = validateProviderKeys({ AI_ENABLED: world.aiEnabled }, world.keys, {
      logger: world.logger,
    });
  } catch (err) {
    world.bootError = err;
  }
}

// ---------------------------------------------------------------- given

Given(
  /^the tier-1 provider will (.+) for the next call$/,
  function (this: AiWorld, outcome: string) {
    this.tier1Outcome = outcome as Tier1Outcome;
  },
);

Given(
  /^the model prices file (has|lacks) a row for the called model$/,
  function (this: AiWorld, state: string) {
    // `lacks` is an empty price table, not a doctored file: the assertion is about what the
    // chain does with a missing lookup, and a real file edit would leak across scenarios.
    this.prices = state === 'has' ? this.prices : new ModelPrices({});
  },
);

Given('AI_ENABLED is {string}', function (this: AiWorld, value: string) {
  this.aiEnabled = value === 'true';
  this.boot = undefined;
  this.bootError = undefined;
});

Given(
  'the {string} key referenced by a loaded prompt file is {string}',
  function (this: AiWorld, provider: string, state: string) {
    this.keys = { ...this.keys, [provider]: state === 'set' ? `test-${provider}-key` : undefined };
    this.boot = undefined;
    this.bootError = undefined;
  },
);

// ---------------------------------------------------------------- when

When(
  'AI_ENABLED is {string} and every referenced provider key is present',
  function (this: AiWorld, value: string) {
    this.aiEnabled = value === 'true';
    this.keys = { openai: 'test-openai-key', google: 'test-google-key' };
    this.boot = undefined;
    this.bootError = undefined;
  },
);

When('the API starts', function (this: AiWorld) {
  boot(this);
});

// ---------------------------------------------------------------- then

Then(/^an? "([^"]+)" event is (emitted|not emitted)$/, function (
  this: AiWorld,
  event: string,
  expectation: string,
) {
  const count = this.eventsNamed(event).length;
  if (expectation === 'emitted') assert.ok(count >= 1, `expected at least one ${event}`);
  else assert.equal(count, 0, `expected no ${event}, saw ${count}`);
});

Then(
  /^exactly (one|two) llm_calls rows? exists? for the call$/,
  function (this: AiWorld, count: string) {
    assert.equal(rows(this).length, CARDINALITY[count]);
  },
);

Then(
  /^(?:the (first|second)|that) llm_calls row has attempt_no (\d+) and (no fell_back_from|fell_back_from set)$/,
  function (this: AiWorld, which: string | undefined, attemptNo: string, fellBack: string) {
    const row = rows(this)[which === 'second' ? 1 : 0];
    assert.ok(row, `no llm_calls row at position ${which ?? 'first'}`);
    assert.equal(row.attemptNo, Number(attemptNo));
    if (fellBack === 'no fell_back_from') assert.equal(row.fellBackFrom, null);
    else assert.ok(row.fellBackFrom, 'fell_back_from is not set on the fallback attempt');
  },
);

Then(
  'exactly {int} questions exist for the HR round',
  function (this: AiWorld, count: number) {
    assert.equal(this.requireBatch().length, count);
  },
);

Then(
  'the llm_calls row carries provider, model, prompt_uuid, prompt_version and unit_kind',
  function (this: AiWorld) {
    const row = rows(this)[0];
    assert.ok(row, 'no llm_calls row was recorded');
    assert.ok(row.provider.length > 0, 'provider is empty');
    assert.ok(row.model.length > 0, 'model is empty');
    assert.ok(row.promptUuid.length > 0, 'prompt_uuid is empty');
    assert.equal(typeof row.promptVersion, 'number');
    assert.ok(row.unitKind.length > 0, 'unit_kind is empty');
  },
);

Then(
  /^the llm_calls row cost_usd is (non-null|null)$/,
  function (this: AiWorld, expectation: string) {
    const row = rows(this)[0];
    assert.ok(row, 'no llm_calls row was recorded');
    if (expectation === 'null') assert.equal(row.costUsd, null);
    else assert.notEqual(row.costUsd, null, 'cost_usd was null but a price row exists');
  },
);

/**
 * I02 owns no HTTP route — `POST /interviews/:id/profile` is I04's. "200" here is the
 * observable this task can actually offer: the generation returned a value instead of
 * throwing. The HTTP status of the route that wraps it is asserted in `profiling.feature`.
 */
Then('the response status is {int}', function (this: AiWorld, status: number) {
  assert.equal(status, 200, 'this step only models the success case');
  assert.equal(this.generateError, undefined, `generation threw: ${String(this.generateError)}`);
});

Then(
  'every generated question satisfies the QuestionBatch schema',
  function (this: AiWorld) {
    QuestionBatchSchema.parse({ questions: this.requireBatch() });
  },
);

Then(
  'exactly one llm_calls row is recorded with cost_usd {int}',
  function (this: AiWorld, cost: number) {
    assert.equal(rows(this).length, 1);
    assert.equal(rows(this)[0].costUsd, cost);
  },
);

Then('startup performed no provider-key validation', function (this: AiWorld) {
  boot(this);
  assert.equal(this.bootError, undefined, 'startup failed instead of skipping validation');
  assert.equal(this.boot?.skipped, true, 'provider keys were validated');
  assert.deepEqual(this.boot?.validated, []);
});

Then(
  /^startup (fails before serving|serves requests)$/,
  function (this: AiWorld, outcome: string) {
    if (outcome === 'serves requests') {
      assert.equal(this.bootError, undefined, `startup failed: ${String(this.bootError)}`);
      return;
    }
    assert.ok(this.bootError, 'startup was expected to fail and did not');
  },
);

Then('the boot error code is {string}', function (this: AiWorld, code: string) {
  if (code === '') {
    assert.equal(this.bootError, undefined, 'a boot error was raised but none was expected');
    return;
  }
  assert.ok(this.bootError instanceof AiError, 'boot failed with something other than an AiError');
  assert.equal((this.bootError as AiError).code, code);
});
