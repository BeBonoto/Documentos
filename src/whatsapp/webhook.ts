/**
 * Rota do webhook da Evolution API. Responde 200 imediatamente e enfileira o
 * processamento (OCR/LLM podem levar segundos e a Evolution reenvia em timeout).
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { createDeduper, createQueue } from '../lib/queue.js';
import { handleIncoming } from '../handlers/index.js';
import { parseEvolutionWebhook } from './parse.js';
import type { EvolutionWebhook } from './types.js';

const queue = createQueue(env.QUEUE_CONCURRENCY);
const isNew = createDeduper();

function validToken(token: unknown): boolean {
  if (typeof token !== 'string') return false;
  const a = Buffer.from(token);
  const b = Buffer.from(env.WEBHOOK_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Querystring: { token?: string }; Body: EvolutionWebhook }>('/webhook/evolution', async (req, reply) => {
    if (!validToken(req.query.token)) return reply.code(401).send({ error: 'unauthorized' });

    const msg = parseEvolutionWebhook(req.body);
    if (msg && isNew(msg.id)) {
      queue.enqueue(() => handleIncoming(msg));
    }
    return { ok: true };
  });
}
