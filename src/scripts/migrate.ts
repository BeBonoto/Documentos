/**
 * Runner de migrations mínimo: aplica db/migrations/*.sql em ordem, uma única vez.
 * Uso: npm run migrate  (ou npm run migrate:prod no container)
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';
import pg from 'pg';

const dir = path.resolve(process.cwd(), 'db/migrations');

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())');
    const applied = new Set((await client.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        console.log(`✔ ${file}`);
      } catch (err) {
        await client.query('rollback');
        throw err;
      }
    }
    console.log('Migrations em dia.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
