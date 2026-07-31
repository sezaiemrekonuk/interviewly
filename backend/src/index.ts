import { AiError } from '@interviewly/ai';

import { validateAiProviderKeys } from '../modules/ai';
import { app } from './app';
import { config } from './lib/env';
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

app.listen(config.API_PORT, () => {
  logger.info({ port: config.API_PORT }, 'SERVER_STARTED');
});
