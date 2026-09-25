/** Ponto de entrada: sobe o HTTP + agendador de lembretes. */
import { env } from './config/env.js';
import { pool } from './lib/db.js';
import { logger } from './lib/logger.js';
import { startReminderScheduler } from './reminders/scheduler.js';
import { buildServer } from './server.js';

async function main() {
  const app = await buildServer();
  const stopScheduler = startReminderScheduler();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info(`🚀 Bot ouvindo na porta ${env.PORT} (storage: ${env.STORAGE_DRIVER})`);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Encerrando...');
    stopScheduler();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Falha ao iniciar');
  process.exit(1);
});
