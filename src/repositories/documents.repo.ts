/** Acesso a dados de `documents` e `chunks`. */
import type pg from 'pg';
import { pool, toVector } from '../lib/db.js';

export interface DocumentRow {
  id: string;
  user_phone: string;
  file_name: string;
  titulo: string | null;
  file_url: string;
  mime_type: string;
  categoria: string;
  tags_sugeridas: string[];
  resumo_curto: string | null;
  doc_date: string | null;
  valor_total: number | null;
  created_at: Date;
}

const DOC_COLUMNS =
  'id, user_phone, file_name, titulo, file_url, mime_type, categoria, tags_sugeridas, resumo_curto, doc_date, valor_total, created_at';

/** Reserva a linha do documento. Retorna null se o mesmo arquivo (hash) já existe para o usuário. */
export async function insertPendingDocument(input: {
  id: string;
  userPhone: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
  contentHash: string;
}): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into documents (id, user_phone, file_name, file_url, mime_type, file_size, content_hash, search_text)
     values ($1, $2, $3, $4, $5, $6, $7, $3)
     on conflict (user_phone, content_hash) do nothing
     returning id`,
    [input.id, input.userPhone, input.fileName, input.fileUrl, input.mimeType, input.fileSize, input.contentHash],
  );
  return rows[0]?.id ?? null;
}

export async function findByHash(userPhone: string, contentHash: string): Promise<DocumentRow | null> {
  const { rows } = await pool.query<DocumentRow>(
    `select ${DOC_COLUMNS} from documents where user_phone = $1 and content_hash = $2`,
    [userPhone, contentHash],
  );
  return rows[0] ?? null;
}

/** Remove um registro que falhou para permitir reenvio do mesmo arquivo. */
export async function deleteDocument(id: string): Promise<void> {
  await pool.query('delete from documents where id = $1', [id]);
}

export async function completeDocument(
  client: pg.PoolClient,
  input: {
    id: string;
    titulo: string;
    categoria: string;
    tags: string[];
    resumo: string;
    docDate: string | null;
    valorTotal: number | null;
    searchText: string;
    embedding: number[];
  },
): Promise<void> {
  await client.query(
    `update documents
        set titulo = $2, categoria = $3, tags_sugeridas = $4, resumo_curto = $5, doc_date = $6,
            valor_total = $7, search_text = $8, embedding = $9::vector, status = 'ready', error = null
      where id = $1`,
    [input.id, input.titulo, input.categoria, input.tags, input.resumo, input.docDate, input.valorTotal, input.searchText, toVector(input.embedding)],
  );
}

export async function insertChunks(
  client: pg.PoolClient,
  documentId: string,
  userPhone: string,
  chunks: { content: string; tokenCount: number; embedding: number[] }[],
): Promise<void> {
  if (!chunks.length) return;
  // Insert multi-linha em uma única query (menos round-trips).
  const values: unknown[] = [];
  const tuples = chunks.map((c, i) => {
    const b = i * 6;
    values.push(documentId, userPhone, i, c.content, c.tokenCount, toVector(c.embedding));
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::vector)`;
  });
  await client.query(
    `insert into chunks (document_id, user_phone, chunk_index, content, token_count, embedding) values ${tuples.join(', ')}`,
    values,
  );
}

/** Listagem sem LLM: por categoria (opcional), mais recentes primeiro. */
export async function listDocuments(userPhone: string, opts: { categoria?: string; limit: number }): Promise<DocumentRow[]> {
  const { rows } = await pool.query<DocumentRow>(
    `select ${DOC_COLUMNS} from documents
      where user_phone = $1 and status = 'ready' and ($2::text is null or categoria = $2)
      order by coalesce(doc_date, created_at::date) desc, created_at desc
      limit $3`,
    [userPhone, opts.categoria ?? null, opts.limit],
  );
  return rows;
}

export async function countByCategory(userPhone: string): Promise<{ categoria: string; total: number }[]> {
  const { rows } = await pool.query<{ categoria: string; total: number }>(
    `select categoria, count(*)::int as total from documents
      where user_phone = $1 and status = 'ready' group by categoria order by total desc`,
    [userPhone],
  );
  return rows;
}
