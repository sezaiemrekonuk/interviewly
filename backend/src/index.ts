import { app } from './app';
import { config } from './lib/env';
import { logger } from './lib/logger';

app.listen(config.API_PORT, () => {
  logger.info({ port: config.API_PORT }, 'SERVER_STARTED');
});
