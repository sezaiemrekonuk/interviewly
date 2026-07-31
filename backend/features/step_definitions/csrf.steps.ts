/**
 * `interview_flow.feature` @AC-15 — the CSRF/origin control on state-changing routes (I05).
 *
 * The scenario is one endpoint, but the property is router-wide: `requirePublicOrigin` is
 * mounted with `router.use` above `router.param`, so it covers routes I06/I07 have not
 * written yet. `csrf.test.ts` pins the composition (GET exempt, resolver never reached);
 * this asserts it end to end through the real app, including that a rejected request leaves
 * the interview where it was.
 */
import { Given, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';

import { config } from '../../src/lib/env';

import { setUpInterview } from './interview-generation.steps';
import { AiWorld } from './world';

Given(
  'I have a session and an interview in {string}',
  async function (this: AiWorld, state: string) {
    await setUpInterview.call(this, 8);
    // `POST /interviews` lands in `profiling` (I03). Any other starting state would need a
    // walk this scenario does not describe, so it is a wiring error, not a fixture to fake.
    assert.equal(state, 'profiling', `@AC-15 only sets up "profiling", not "${state}"`);
  },
);

/** `:id` is literal in the feature text — the scenario means the interview it just created. */
function resolve(this: AiWorld, path: string): string {
  return path.replace(':id', this.interviewId);
}

When(
  'I POST {string} with Origin {string}',
  async function (this: AiWorld, path: string, origin: string) {
    await this.httpPost(resolve.call(this, path), this.profileBody, { origin });
  },
);

When(
  'I POST {string} with Origin equal to PUBLIC_ORIGIN',
  async function (this: AiWorld, path: string) {
    await this.httpPost(resolve.call(this, path), this.profileBody, {
      origin: config.PUBLIC_ORIGIN,
    });
  },
);
