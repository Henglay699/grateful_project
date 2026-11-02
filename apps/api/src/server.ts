import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { pool } from './db/client';
import { startExchangeRateSync } from './modules/settings/rateSync';
import { startMarketSync } from './modules/settings/marketSync';
import { startChatRetention } from './modules/chat/retention';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT}  (docs: /api/docs)`);
});
const stopRateSync = startExchangeRateSync();
const stopMarketSync = startMarketSync();
const stopChatRetention = startChatRetention();

function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  stopRateSync();
  stopMarketSync();
  stopChatRetention();
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) =>
  logger.error({ reason }, 'Unhandled promise rejection'),
);
