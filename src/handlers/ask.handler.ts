/**
 * Intenção PERGUNTA (RAG enxuto):
 *  - top-k pequeno, contexto com teto de caracteres, saída com teto de tokens;
 *  - se nada relevante for encontrado, responde SEM chamar o LLM.
 */
import { env } from '../config/env.js';
import { chat } from '../lib/openai.js';
import { setLastList, type DocRef } from '../lib/session.js';
import { searchChunks } from '../search/hybrid.js';
import { formatBR } from '../utils/dates.js';
import { sendText } from '../whatsapp/evolution.client.js';

const SYSTEM =
  'Você responde perguntas sobre os documentos pessoais do usuário usando SOMENTE o contexto fornecido. ' +
  'Responda em português, de forma direta (no máximo 3 frases), com valores e datas exatos. ' +
  'Cite a fonte como [n]. Se a resposta não estiver no contexto, diga apenas: "Não encontrei essa informação nos seus documentos."';

export async function handleAsk(phone: string, question: string): Promise<void> {
  const hits = await searchChunks(phone, question, env.RAG_TOP_K);

  // Economia: sem contexto relevante não há por que pagar uma chamada de LLM.
  if (!hits.length || hits[0].similarity < env.RAG_MIN_SIMILARITY) {
    return sendText(phone, '🤷 Não encontrei nada sobre isso nos seus documentos.');
  }

  // Numera as fontes por documento e monta o contexto até o teto de caracteres.
  const sources: DocRef[] = [];
  const labels: string[] = [];
  const sourceIndex = new Map<string, number>();
  const parts: string[] = [];
  let budget = env.RAG_MAX_CONTEXT_CHARS;

  for (const h of hits) {
    if (budget <= 0) break;
    let n = sourceIndex.get(h.document_id);
    if (!n) {
      sources.push({ id: h.document_id, fileName: h.file_name, fileUrl: h.file_url, mimeType: h.mime_type });
      labels.push(h.titulo || h.file_name);
      n = sources.length;
      sourceIndex.set(h.document_id, n);
    }
    const header = `[${n}] ${h.titulo || h.file_name}${h.doc_date ? ` (${formatBR(h.doc_date)})` : ''}`;
    const content = h.content.slice(0, budget);
    budget -= content.length;
    parts.push(`${header}\n${content}`);
  }

  const answer = await chat({
    system: SYSTEM,
    user: `Contexto:\n${parts.join('\n---\n')}\n\nPergunta: ${question.slice(0, 500)}`,
    maxTokens: env.RAG_MAX_OUTPUT_TOKENS,
  });

  setLastList(phone, sources);
  const footer = labels.map((l, i) => `${i + 1}. ${l}`).join('\n');
  await sendText(phone, `${answer}\n\n📎 *Fontes:*\n${footer}\n_Responda com o número para receber o arquivo._`);
}
