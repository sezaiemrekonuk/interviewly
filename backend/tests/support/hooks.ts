import { AfterAll, Before, BeforeAll } from '@cucumber/cucumber';

import { bootApp, resetState, stopApp } from './harness';
import { installLogSink, resetLogSink } from './log-sink';
import { installMailRecorder, resetMailRecorder } from './mail-recorder';

BeforeAll({ timeout: 60_000 }, async () => {
  await bootApp();
  installLogSink();
  installMailRecorder();
});

Before(async () => {
  await resetState();
  resetLogSink();
  resetMailRecorder();
});

AfterAll(async () => {
  await stopApp();
});
