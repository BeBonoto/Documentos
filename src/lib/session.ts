/**
 * Estado conversacional curto em memória: guarda a última lista enviada para que
 * o usuário responda só com "2" e receba o arquivo (0 tokens).
 * Para múltiplas réplicas, troque por Redis mantendo a mesma interface.
 */
export interface DocRef {
  id: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
}

const TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, { list: DocRef[]; expiresAt: number }>();

export function setLastList(phone: string, list: DocRef[]): void {
  sessions.set(phone, { list, expiresAt: Date.now() + TTL_MS });
}

export function getLastList(phone: string): DocRef[] {
  const s = sessions.get(phone);
  if (!s || s.expiresAt < Date.now()) {
    sessions.delete(phone);
    return [];
  }
  return s.list;
}

// Limpeza periódica para não vazar memória.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) if (v.expiresAt < now) sessions.delete(k);
}, TTL_MS).unref();
