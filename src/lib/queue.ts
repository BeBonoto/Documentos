/**
 * Fila em memória com concorrência limitada + deduplicação de mensagens.
 * O webhook responde 200 na hora e o processamento pesado (OCR/LLM) roda aqui.
 * Para produção com alto volume, troque por BullMQ/SQS mantendo `enqueue`.
 */
import { logger } from './logger.js';

export function createQueue(concurrency: number) {
  const pending: (() => Promise<void>)[] = [];
  let running = 0;

  const next = () => {
    while (running < concurrency && pending.length) {
      const job = pending.shift()!;
      running++;
      job()
        .catch((err) => logger.error({ err }, 'Job falhou'))
        .finally(() => {
          running--;
          next();
        });
    }
  };

  return {
    enqueue(job: () => Promise<void>) {
      pending.push(job);
      next();
    },
    get size() {
      return pending.length + running;
    },
  };
}

/** Evita processar a mesma mensagem duas vezes (a Evolution pode reenviar webhooks). */
export function createDeduper(max = 5000) {
  const seen = new Set<string>();
  return (id: string): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > max) seen.delete(seen.values().next().value!);
    return true;
  };
}
