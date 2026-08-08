// FIRST, and it stays first (I15): `@prisma/client` loads a repo-root `.env` into
// process.env when it is imported, so any import ahead of this one lets a variable the
// process was NOT given pass the check — the boot would then "succeed" on config nobody
// deployed. env.ts must see the real environment.
import { config } from './lib/env';

import { AiError } from '@interviewly/ai';

import { validateAiProviderKeys } from '../modules/ai';
import { closeEventStreams } from '../modules/interview/sse';
import { app } from './app';
import { logger } from './lib/logger';

// B7 fail-fast, alongside the F03 env check: a provider named by a loaded prompt file with
// no key aborts the boot rather than surfacing as a 500 on the first interview of the day.
// Skipped entirely when AI_ENABLED=false, so a teammate with no keys still boots.
try {
  const keys = validateAiProviderKeys();
  logger.info({ skipped: keys.skipped, providers: keys.validated }, 'AI_PROVIDER_KEYS_CHECKED');
} catch (err) {
  // Names the code and the providers, never a key or the variable it should have come from.
  logger.error({ code: err instanceof AiError ? err.code : 'UNKNOWN' }, 'BOOT_FAILED');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const server = app.listen(config.API_PORT, () => {
  logger.info({ port: config.API_PORT }, 'SERVER_STARTED');
});

// The ceiling on the drain, and `compose.yaml`'s `stop_grace_period` is set above it so Docker
// waits for this rather than pre-empting it with SIGKILL.
const DRAIN_TIMEOUT_MS = 10_000;

let stopping = false;

/**
 * Same contract as the worker's shutdown: stop taking work, finish what is in flight, exit.
 *
 * `server.close()` is the whole drain — it refuses new connections, drops the idle keep-alive
 * ones, and resolves once the responses still in flight have ended. The one thing it cannot
 * resolve on its own is an SSE stream, which is in flight until the client goes away and on a
 * deploy has no reason to; ending those is what lets the drain finish rather than always
 * running out the clock. The timeout is the ceiling for everything else.
 */
function shutdown(signal: NodeJS.Signals): void {
  if (stopping) return; // A second Ctrl-C must not restart the clock.
  stopping = true;
  logger.info({ signal }, 'SERVER_STOPPING');

  server.close(() => {
    logger.info({ signal }, 'SERVER_STOPPED');
    process.exit(0);
  });
  closeEventStreams();

  setTimeout(() => {
    logger.warn({ signal, timeoutMs: DRAIN_TIMEOUT_MS }, 'SERVER_STOP_TIMEOUT');
    process.exit(1);
  }, DRAIN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
