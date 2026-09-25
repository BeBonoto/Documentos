/**
 * Chunking por parágrafos com sobreposição (função pura).
 * Chunks de ~1200 caracteres (~300 tokens) mantêm o contexto do RAG pequeno:
 * top-4 chunks ≈ 1.200 tokens de entrada por pergunta.
 */
export interface ChunkOptions {
  size: number;
  overlap: number;
}

export function chunkText(text: string, { size, overlap }: ChunkOptions): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  // Quebra em parágrafos; parágrafos gigantes são fatiados por frases/tamanho.
  const pieces: string[] = [];
  for (const para of clean.split(/\n{2,}/)) {
    if (para.length <= size) {
      pieces.push(para);
      continue;
    }
    const sentences = para.match(/[^.!?\n]+[.!?]?\s*/g) ?? [para];
    for (const s of sentences) {
      for (let i = 0; i < s.length; i += size) pieces.push(s.slice(i, i + size));
    }
  }

  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length + 1 > size) {
      chunks.push(current.trim());
      // Sobreposição: carrega o final do chunk anterior para não cortar contexto.
      current = current.slice(-overlap) + '\n';
    }
    current += piece + '\n';
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
