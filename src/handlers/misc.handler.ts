/** Intenções auxiliares: escolher item de lista, lembretes e ajuda. ZERO tokens. */
import { getLastList } from '../lib/session.js';
import { listUpcoming } from '../repositories/reminders.repo.js';
import { formatBR } from '../utils/dates.js';
import { sendText } from '../whatsapp/evolution.client.js';
import { HELP_TEXT } from './format.js';
import { sendDocument } from './send.js';

export async function handlePick(phone: string, index: number): Promise<void> {
  const doc = getLastList(phone)[index - 1];
  if (!doc) {
    return sendText(phone, 'Não tenho uma lista ativa com esse número. Use `/ultimos` ou `/listar` primeiro.');
  }
  await sendDocument(phone, doc);
}

export async function handleReminders(phone: string): Promise<void> {
  const items = await listUpcoming(phone);
  if (!items.length) return sendText(phone, '✅ Nenhum vencimento futuro registrado.');
  const lines = items.map((r) => `📅 *${formatBR(r.due_date)}* — ${r.title}${r.file_name ? ` _(${r.file_name})_` : ''}`);
  await sendText(phone, `⏰ *Próximos vencimentos*\n\n${lines.join('\n')}`);
}

export const handleHelp = (phone: string) => sendText(phone, HELP_TEXT);
