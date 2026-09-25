/** Acesso a dados de `reminders`. */
import type pg from 'pg';
import { pool } from '../lib/db.js';

export interface ReminderRow {
  id: number;
  user_phone: string;
  document_id: string | null;
  title: string;
  due_date: string;
  remind_at: Date;
  attempts: number;
}

/**
 * Cria lembretes para um vencimento: D-N e no próprio dia, às REMINDER_HOUR no fuso
 * configurado. O cálculo de fuso é feito no Postgres (sem libs de data no Node).
 * Lembretes cujo horário já passou são ignorados.
 */
export async function createRemindersForDue(
  client: pg.PoolClient,
  input: { userPhone: string; documentId: string; title: string; dueDate: string; daysBefore: number; hour: number; tz: string },
): Promise<number> {
  const offsets = [...new Set([input.daysBefore, 0])];
  const { rowCount } = await client.query(
    `insert into reminders (user_phone, document_id, title, due_date, remind_at)
     select $1, $2, $3, $4::date, ts
       from (select ((($4::date - d_off) + make_time($5, 0, 0)) at time zone $6) as ts
               from unnest($7::int[]) as d_off) t
      where ts > now()
     on conflict do nothing`,
    [input.userPhone, input.documentId, input.title, input.dueDate, input.hour, input.tz, offsets],
  );
  return rowCount ?? 0;
}

/**
 * "Reivindica" lembretes vencidos de forma atômica (seguro com várias réplicas):
 * FOR UPDATE SKIP LOCKED + status 'sending'.
 */
export async function claimDueReminders(limit = 20): Promise<ReminderRow[]> {
  const { rows } = await pool.query<ReminderRow>(
    `update reminders r set status = 'sending', attempts = attempts + 1
      where r.id in (
        select id from reminders
         where status = 'pending' and remind_at <= now()
         order by remind_at
         limit $1
         for update skip locked)
      returning r.id, r.user_phone, r.document_id, r.title, r.due_date, r.remind_at, r.attempts`,
    [limit],
  );
  return rows;
}

export async function markSent(id: number): Promise<void> {
  await pool.query(`update reminders set status = 'sent', sent_at = now(), last_error = null where id = $1`, [id]);
}

/** Volta para 'pending' (nova tentativa no próximo ciclo) ou 'failed' após 3 tentativas. */
export async function markRetry(id: number, attempts: number, error: string): Promise<void> {
  await pool.query(`update reminders set status = $2, last_error = $3 where id = $1`, [
    id,
    attempts >= 3 ? 'failed' : 'pending',
    error.slice(0, 500),
  ]);
}

/** Recupera lembretes presos em 'sending' (ex.: processo morreu no meio do envio). */
export async function releaseStuckReminders(): Promise<void> {
  await pool.query(`update reminders set status = 'pending' where status = 'sending' and remind_at < now() - interval '15 minutes'`);
}

/** Próximos vencimentos do usuário (um por documento/data). */
export async function listUpcoming(userPhone: string, limit = 10): Promise<(ReminderRow & { file_name: string | null })[]> {
  const { rows } = await pool.query(
    `select distinct on (r.due_date, r.document_id)
            r.id, r.user_phone, r.document_id, r.title, r.due_date, r.remind_at, r.attempts,
            coalesce(d.titulo, d.file_name) as file_name
       from reminders r left join documents d on d.id = r.document_id
      where r.user_phone = $1 and r.due_date >= current_date and r.status <> 'cancelled'
      order by r.due_date, r.document_id, r.remind_at
      limit $2`,
    [userPhone, limit],
  );
  return rows;
}
