/**
 * Busca híbrida (vetorial + full-text + metadados) — tudo dentro do Postgres.
 *
 *  - searchDocuments: nível DOCUMENTO (para devolver o arquivo original, sem LLM).
 *  - searchChunks:    nível CHUNK (contexto do RAG).
 */
import { pool, toVector } from '../lib/db.js';
import { embed } from '../lib/openai.js';
import type { DocumentRow } from '../repositories/documents.repo.js';
import { parseQuery, type ParsedQuery } from './queryParser.js';

export interface DocumentHit extends DocumentRow {
  score: number;
}

export interface ChunkHit {
  document_id: string;
  file_name: string;
  file_url: string;
  mime_type: string;
  titulo: string | null;
  doc_date: string | null;
  content: string;
  similarity: number;
}

// Pesos da fusão. Categoria/data são "boosts" (não filtros rígidos), porque o
// LLM pode ter classificado "conta de luz" como Moradia OU Finanças.
const W_VECTOR = 0.65;
const W_TEXT = 0.35;
const W_CATEGORY = 0.1;

/** OR entre termos: "conta or luz" (websearch_to_tsquery faria AND por padrão). */
const toTsQuery = (terms: string[]) => terms.slice(0, 8).join(' or ');

async function queryDocuments(userPhone: string, vector: string, q: ParsedQuery, useDate: boolean, limit: number) {
  const { rows } = await pool.query<DocumentHit>(
    `select id, user_phone, file_name, titulo, file_url, mime_type, categoria, tags_sugeridas,
            resumo_curto, doc_date, valor_total, created_at,
            ( $3::float8 * (1 - (embedding <=> $2::vector))
            + $4::float8 * ts_rank_cd(search_tsv, websearch_to_tsquery('pt_unaccent', $5), 32)
            + case when categoria = $6::text then $7::float8 else 0 end ) as score
       from documents
      where user_phone = $1 and status = 'ready' and embedding is not null
        and ($8::date is null or coalesce(doc_date, created_at::date) between $8::date and $9::date)
      order by score desc
      limit $10`,
    [
      userPhone, vector, W_VECTOR, W_TEXT, toTsQuery(q.terms), q.categoria, W_CATEGORY,
      useDate ? q.dateFrom : null, useDate ? q.dateTo : null, limit,
    ],
  );
  return rows;
}

/**
 * "o último"/"a mais recente": entre os resultados quase tão relevantes quanto o
 * melhor (>= 85% do score), escolhe o de data mais recente.
 */
function preferLatest<T extends { score: number; doc_date: string | null; created_at: Date }>(hits: T[]): T[] {
  if (hits.length < 2) return hits;
  const threshold = hits[0].score * 0.85;
  const dateOf = (h: T) => h.doc_date ?? h.created_at.toISOString().slice(0, 10);
  const close = hits.filter((h) => h.score >= threshold).sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  return [...close, ...hits.filter((h) => h.score < threshold)];
}

export async function searchDocuments(userPhone: string, text: string, limit = 5): Promise<DocumentHit[]> {
  const q = parseQuery(text);
  const [embedding] = await embed([text]);
  const vector = toVector(embedding);

  let hits = await queryDocuments(userPhone, vector, q, true, limit);
  // Filtro de data zerou os resultados? Tenta de novo sem ele.
  if (!hits.length && q.dateFrom) hits = await queryDocuments(userPhone, vector, q, false, limit);
  return q.latest ? preferLatest(hits) : hits;
}

export async function searchChunks(userPhone: string, text: string, topK: number): Promise<ChunkHit[]> {
  const q = parseQuery(text);
  const [embedding] = await embed([text]);
  const vector = toVector(embedding);

  const run = async (useDate: boolean) =>
    (
      await pool.query<ChunkHit & { created_at: Date }>(
        `select c.document_id, d.file_name, d.file_url, d.mime_type, d.titulo, d.doc_date, d.created_at, c.content,
                1 - (c.embedding <=> $2::vector) as similarity
           from chunks c join documents d on d.id = c.document_id
          where c.user_phone = $1 and d.status = 'ready'
            and ($3::date is null or coalesce(d.doc_date, d.created_at::date) between $3::date and $4::date)
          order by c.embedding <=> $2::vector
          limit $5`,
        // Busca um pouco mais que top-k para poder priorizar o documento mais recente.
        [userPhone, vector, useDate ? q.dateFrom : null, useDate ? q.dateTo : null, topK * 3],
      )
    ).rows;

  let rows = await run(true);
  if (!rows.length && q.dateFrom) rows = await run(false);
  if (!rows.length) return [];

  if (q.latest) {
    // Mantém só chunks do documento mais recente entre os relevantes.
    const ranked = preferLatest(rows.map((r) => ({ ...r, score: r.similarity })));
    const bestDoc = ranked[0].document_id;
    rows = rows.filter((r) => r.document_id === bestDoc);
  }
  return rows.slice(0, topK);
}
