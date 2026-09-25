/** Utilitários de texto puros (sem dependências externas — fáceis de testar). */

/** minúsculas, sem acentos, espaços colapsados. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Estimativa barata de tokens (~4 caracteres/token para PT-BR). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Limpa o texto extraído (OCR/PDF) removendo ruído que só gastaria tokens. */
export function cleanExtractedText(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Trunca mantendo início e fim do documento (totais e vencimentos costumam
 * aparecer no final de boletos/faturas).
 */
export function truncateHeadTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.75);
  const tail = maxChars - head;
  return `${text.slice(0, head)}\n[...]\n${text.slice(-tail)}`;
}

/** Palavras que não ajudam na busca textual (stopwords + verbos de pedido). */
export const SEARCH_STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos',
  'nas', 'em', 'e', 'ou', 'para', 'pra', 'pro', 'por', 'com', 'sem', 'que', 'me', 'meu', 'minha', 'meus',
  'minhas', 'mim', 'eu', 'voce', 'se', 'ai', 'aqui', 'la', 'esse', 'essa', 'este', 'esta', 'isso', 'isto',
  'favor', 'porfavor', 'pf', 'pfv', 'por favor', 'ultimo', 'ultima', 'ultimos', 'ultimas', 'recente',
  'mais', 'manda', 'mande', 'mandar', 'envia', 'envie', 'enviar', 'encaminha', 'encaminhe', 'baixar', 'baixa',
  'quero', 'queria', 'preciso', 'precisava', 'passa', 'passe', 'cade', 'arquivo', 'documento', 'pdf',
  'foto', 'imagem', 'ver', 'mostra', 'mostre', 'qual', 'quanto', 'quando', 'onde', 'como', 'paguei',
  'tenho', 'tem', 'foi', 'era', 'ser', 'dia', 'mes', 'ano', 'via', 'segunda', 'copia',
]);

/** Extrai termos relevantes para o full-text search. */
export function keywords(text: string): string[] {
  return normalize(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !SEARCH_STOPWORDS.has(w));
}
