/** Intenção BAIXAR ARQUIVO: busca híbrida + envio do original. ZERO tokens de LLM. */
import { setLastList } from '../lib/session.js';
import { searchDocuments } from '../search/hybrid.js';
import { sendText } from '../whatsapp/evolution.client.js';
import { displayName, formatDocList, toDocRef } from './format.js';
import { sendDocument } from './send.js';

/** Score mínimo da fusão (0.65·cos + 0.35·texto + boost) para considerar relevante. */
const MIN_SCORE = 0.2;

export async function handleFetch(phone: string, query: string): Promise<void> {
  const hits = (await searchDocuments(phone, query, 5)).filter((h) => h.score >= MIN_SCORE);
  if (!hits.length) {
    return sendText(phone, '🔎 Não encontrei esse documento. Tente outras palavras ou use `/ultimos` para ver os recentes.');
  }

  const [best, ...others] = hits;
  await sendDocument(phone, toDocRef(best), `📄 ${displayName(best)}`);

  // Alternativas prontas para "responda o número" (a lista começa pelo enviado).
  setLastList(phone, hits.map(toDocRef));
  if (others.length) {
    await sendText(phone, `Não era esse? Outros resultados:\n${formatDocList(others, 2)}\n\nResponda com o número.`);
  }
}
