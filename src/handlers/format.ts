/** Formatação de mensagens do WhatsApp (sem LLM). */
import type { DocRef } from '../lib/session.js';
import type { DocumentRow } from '../repositories/documents.repo.js';
import { formatBR } from '../utils/dates.js';

const ICON: Record<string, string> = {
  Finanças: '💰', Moradia: '🏠', Saúde: '🩺', Contratos: '📑', Veículos: '🚗',
  Impostos: '🧾', Identidade: '🪪', Educação: '🎓', Trabalho: '💼', Outros: '📄',
};

export const categoryIcon = (c: string) => ICON[c] ?? '📄';

export const displayName = (d: Pick<DocumentRow, 'titulo' | 'file_name'>) => d.titulo || d.file_name;

export function toDocRef(d: DocumentRow): DocRef {
  return { id: d.id, fileName: d.file_name, fileUrl: d.file_url, mimeType: d.mime_type };
}

/** Lista numerada; `start` permite continuar a numeração (ex.: alternativas a partir do 2). */
export function formatDocList(docs: DocumentRow[], start = 1): string {
  return docs
    .map((d, i) => {
      const date = formatBR(d.doc_date) || formatBR(d.created_at.toISOString());
      return `*${i + start}.* ${categoryIcon(d.categoria)} ${displayName(d)}\n     _${d.categoria} · ${date}_`;
    })
    .join('\n');
}

export const formatMoney = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const HELP_TEXT = [
  '📂 *Organizador de Documentos*',
  '',
  '• *Envie* um PDF, foto ou DOCX e eu guardo, classifico e aviso vencimentos.',
  '• *Peça um arquivo:* "me manda a conta de luz de janeiro"',
  '• *Pergunte:* "quanto paguei na última conta de luz?"',
  '',
  '*Comandos rápidos:*',
  '`/ultimos` — últimos documentos',
  '`/listar financas` — por categoria (`/listar` mostra todas)',
  '`/lembretes` — próximos vencimentos',
  '`/buscar <termo>` — buscar um arquivo',
  '',
  'Depois de uma lista, responda só com o *número* para receber o arquivo.',
].join('\n');
