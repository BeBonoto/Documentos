/**
 * Pool do Postgres + helpers para pgvector.
 */
import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from './logger.js';

// Retorna colunas DATE como string 'YYYY-MM-DD' (evita surpresas de fuso horário).
pg.types.setTypeParser(1082, (v) => v);
// NUMERIC -> number (valores monetários cabem com folga em double).
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

pool.on('error', (err) => logger.error({ err }, 'Erro inesperado no pool do Postgres'));

/** Converte um vetor JS para o literal aceito pelo pgvector: '[0.1,0.2,...]'. */
export function toVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/** Executa `fn` dentro de uma transação. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
