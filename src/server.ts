/** Montagem do servidor HTTP (Fastify). */
import Fastify from 'fastify';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { pool } from './lib/db.js';
import { readLocalFile, verifyLocalSignature } from './storage/storage.js';
import { webhookRoutes } from './whatsapp/webhook.js';

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8',
};

export async function buildServer() {
  const app = Fastify({
    loggerInstance: logger,
    // Webhooks com base64 embutido podem ser grandes.
    bodyLimit: Math.ceil(env.MAX_FILE_MB * 1.5 * 1024 * 1024),
  });

  app.get('/health', async () => {
    await pool.query('select 1');
    return { ok: true };
  });

  await app.register(webhookRoutes);

  // Download assinado para o driver de storage local (a Evolution busca daqui).
  if (env.STORAGE_DRIVER === 'local') {
    app.get<{ Params: { '*': string }; Querystring: { exp?: string; sig?: string } }>('/files/*', async (req, reply) => {
      const key = req.params['*'];
      if (!verifyLocalSignature(key, Number(req.query.exp), req.query.sig ?? '')) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      try {
        const data = await readLocalFile(key);
        const ext = key.split('.').pop() ?? '';
        return reply.type(CONTENT_TYPES[ext] ?? 'application/octet-stream').send(data);
      } catch {
        return reply.code(404).send({ error: 'not found' });
      }
    });
  }

  return app;
}
