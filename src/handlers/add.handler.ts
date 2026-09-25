/** Intenção ADICIONAR: roda o pipeline e responde com o resumo da indexação. */
import { ingestDocument } from '../pipeline/ingest.js';
import { formatBR } from '../utils/dates.js';
import { sendText } from '../whatsapp/evolution.client.js';
import type { IncomingMessage } from '../whatsapp/types.js';
import { categoryIcon, formatMoney } from './format.js';

export async function handleAdd(msg: IncomingMessage): Promise<void> {
  await sendText(msg.phone, '⏳ Recebi! Estou lendo e organizando o documento...');
  const result = await ingestDocument(msg);

  if (result.status === 'rejected') return sendText(msg.phone, `⚠️ ${result.reason}`);
  if (result.status === 'duplicate') return sendText(msg.phone, `📎 Esse arquivo já está salvo como *${result.fileName}*.`);

  const { meta } = result;
  const lines = [
    `✅ *${meta.titulo}* salvo!`,
    `${categoryIcon(meta.categoria)} ${meta.categoria}${meta.tags.length ? ` · ${meta.tags.join(', ')}` : ''}`,
  ];
  if (meta.resumo) lines.push(`📝 ${meta.resumo}`);
  if (meta.valorTotal !== null) lines.push(`💵 ${formatMoney(meta.valorTotal)}`);
  for (const v of meta.vencimentos) lines.push(`📅 ${v.descricao}: ${formatBR(v.data)}`);
  if (result.remindersCreated) lines.push(`⏰ Vou te lembrar antes do vencimento.`);
  if (!result.hasText) lines.push('⚠️ Não consegui ler o texto (imagem escura/ilegível?). O arquivo foi salvo, mas perguntas sobre o conteúdo podem falhar.');
  await sendText(msg.phone, lines.join('\n'));
}
