/** Intenção LISTAR / comandos /listar e /ultimos. ZERO tokens de LLM. */
import { setLastList } from '../lib/session.js';
import { countByCategory, listDocuments } from '../repositories/documents.repo.js';
import { CATEGORIES, resolveCategoryArg } from '../utils/categories.js';
import { sendText } from '../whatsapp/evolution.client.js';
import { categoryIcon, formatDocList, toDocRef } from './format.js';

export async function handleList(phone: string, opts: { categoria?: string; limit?: number }): Promise<void> {
  let categoria: string | undefined;
  if (opts.categoria) {
    const resolved = resolveCategoryArg(opts.categoria);
    if (!resolved) {
      return sendText(phone, `Categoria não encontrada. Opções: ${CATEGORIES.join(', ')}`);
    }
    categoria = resolved;
  }

  const docs = await listDocuments(phone, { categoria, limit: opts.limit ?? 10 });
  if (!docs.length) {
    return sendText(phone, categoria ? `Nenhum documento em *${categoria}* ainda.` : 'Você ainda não enviou documentos. Mande um PDF ou foto para começar!');
  }

  setLastList(phone, docs.map(toDocRef));
  const header = categoria
    ? `${categoryIcon(categoria)} *${categoria}* (${docs.length})`
    : opts.limit
      ? `🕒 *Últimos ${docs.length} documentos*`
      : await overviewHeader(phone);

  await sendText(phone, `${header}\n\n${formatDocList(docs)}\n\n_Responda com o número para receber o arquivo._`);
}

/** Resumo por categoria para o `/listar` sem argumentos. */
async function overviewHeader(phone: string): Promise<string> {
  const counts = await countByCategory(phone);
  const summary = counts.map((c) => `${categoryIcon(c.categoria)} ${c.categoria}: ${c.total}`).join('\n');
  return `📂 *Seus documentos*\n${summary}\n\n🕒 *Mais recentes:*`;
}
