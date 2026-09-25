/**
 * Agendador de lembretes: polling simples no Postgres (sem Redis).
 * Seguro com múltiplas réplicas graças ao FOR UPDATE SKIP LOCKED.
 */
import { env } from '../config/env.js';
import { pool } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { setLastList } from '../lib/session.js';
import { claimDueReminders, markRetry, markSent, releaseStuckReminders, type ReminderRow } from '../repositories/reminders.repo.js';
import { formatBR, todayInTz } from '../utils/dates.js';
import { sendText } from '../whatsapp/evolution.client.js';

function daysUntil(dueDate: string): number {
  const today = todayInTz(env.REMINDER_TZ);
  return Math.round((Date.parse(dueDate) - Date.parse(today)) / 86_400_000);
}

function buildMessage(r: ReminderRow, docName: string | null): string {
  const days = daysUntil(r.due_date);
  const when = days <= 0 ? '*vence hoje*' : days === 1 ? 'vence *amanhã*' : `vence em *${days} dias*`;
  const lines = [`⏰ *Lembrete:* ${r.title} ${when} (${formatBR(r.due_date)}).`];
  if (docName) lines.push(`📄 ${docName} — responda *1* para receber o arquivo.`);
  return lines.join('\n');
}

async function tick(): Promise<void> {
  await releaseStuckReminders();
  const due = await claimDueReminders();
  for (const r of due) {
    try {
      let docName: string | null = null;
      if (r.document_id) {
        const { rows } = await pool.query(
          'select id, file_name, titulo, file_url, mime_type from documents where id = $1',
          [r.document_id],
        );
        const d = rows[0];
        if (d) {
          docName = d.titulo || d.file_name;
          setLastList(r.user_phone, [{ id: d.id, fileName: d.file_name, fileUrl: d.file_url, mimeType: d.mime_type }]);
        }
      }
      await sendText(r.user_phone, buildMessage(r, docName));
      await markSent(r.id);
    } catch (err) {
      logger.error({ err, reminderId: r.id }, 'Falha ao enviar lembrete');
      await markRetry(r.id, r.attempts, err instanceof Error ? err.message : String(err));
    }
  }
}

export function startReminderScheduler(): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch (err) {
      logger.error({ err }, 'Erro no ciclo de lembretes');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, env.REMINDER_POLL_SECONDS * 1000);
  void run();
  return () => clearInterval(timer);
}
