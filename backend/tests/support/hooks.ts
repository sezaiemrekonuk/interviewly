import { AfterAll, Before, BeforeAll } from '@cucumber/cucumber';

import { bootApp, resetState, stopApp } from './harness';

BeforeAll({ timeout: 60_000 }, async () => {
  await bootApp();
});

Before(async () => {
  await resetState();
});

AfterAll(async () => {
  await stopApp();
});
