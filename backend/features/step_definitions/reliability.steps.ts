/**
 * `reliability.feature` @AC-19 (I14). `I fetch GET`, `the response status is` and `the
 * response error code is` are the shared steps (answers.steps.ts, ai-provider.steps.ts,
 * interview-setup.steps.ts) — this file only owns the dependency-down seam.
 */
import { Given } from '@cucumber/cucumber';

import { setProbeOverrides } from '../../src/lib/probes';

const DOWN = () => Promise.reject(new Error('unreachable'));

Given('Postgres and Redis are reachable', function () {
  setProbeOverrides({});
});

Given('{word} is unreachable', function (dependency: string) {
  if (dependency === 'Postgres') setProbeOverrides({ pingPostgres: DOWN });
  else if (dependency === 'Redis') setProbeOverrides({ pingRedis: DOWN });
  else throw new Error(`unknown dependency "${dependency}"`);
});
