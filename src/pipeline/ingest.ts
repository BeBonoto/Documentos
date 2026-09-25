/**
 * Pipeline de ingestão:
 *   Download -> validação/dedup (hash) -> Storage -> Extração (PDF/OCR) ->
 *   Classificação (1 chamada LLM) -> Chunking -> Embeddings (1 chamada em lote) ->
 *   Persistência transacional (chunks + metadados + lembretes)
 */
import { createHash, randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { withTransaction } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { embed } from '../lib/openai.js';
import { completeDocument, deleteDocument, findByHash, insertChunks, insertPendingDocument } from '../repositories/documents.repo.js';
import { createRemindersForDue } from '../repositories/reminders.repo.js';
import { storage } from '../storage/storage.js';
import { estimateTokens } from '../utils/text.js';
import { todayInTz } from '../utils/dates.js';
import { downloadMedia } from '../whatsapp/evolution.client.js';
import type { IncomingMessage } from '../whatsapp/types.js';
import { chunkText } from './chunk.js';
import { classifyDocument, type DocumentMetadata } from './classify.js';
import { DOCX_MIME, extractText, isSupportedMime } from './extract.js';

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  [DOCX_MIME]: 'docx',
  'text/plain': 'txt',
};

export type IngestResult =
  | { status: 'saved'; documentId: string; fileName: string; meta: DocumentMetadata; remindersCreated: number; hasText: boolean }
  | { status: 'duplicate'; documentId: string; fileName: string }
  | { status: 'rejected'; reason: string };

/** Texto que representa o documento inteiro na busca por ARQUIVO. */
function buildDocumentCard(meta: DocumentMetadata, fileName: string, caption: string): string {
  return [meta.titulo, meta.categoria, meta.tags.join(', '), meta.resumo, fileName, caption].filter(Boolean).join(' | ');
}

export async function ingestDocument(msg: IncomingMessage): Promise<IngestResult> {
  const media = msg.media;
  if (!media) return { status: 'rejected', reason: 'Mensagem sem arquivo.' };

  const mime = media.mimetype.split(';')[0].trim().toLowerCase();
  if (!isSupportedMime(mime)) {
    return { status: 'rejected', reason: 'Formato não suportado. Envie PDF, imagem (JPG/PNG), DOCX ou TXT.' };
  }

  // 1) Download (o webhook pode já trazer o base64 se "webhook_base64" estiver ativo).
  const base64 = media.base64 ?? (await downloadMedia(msg.id)).base64;
  const data = Buffer.from(base64, 'base64');
  if (data.length > env.MAX_FILE_MB * 1024 * 1024) {
    return { status: 'rejected', reason: `Arquivo maior que ${env.MAX_FILE_MB} MB.` };
  }

  // 2) Dedup por hash: o mesmo arquivo não é reprocessado (economiza OCR + tokens).
  const contentHash = createHash('sha256').update(data).digest('hex');
  const ext = EXT_BY_MIME[mime] ?? media.fileName?.split('.').pop() ?? 'bin';
  const fileName = media.fileName || `${media.kind === 'image' ? 'imagem' : 'documento'}-${todayInTz(env.REMINDER_TZ)}.${ext}`;
  const id = randomUUID();
  // A chave do objeto nunca usa o nome enviado pelo usuário (evita path traversal).
  const fileUrl = `${msg.phone}/${id}.${ext}`;

  const reserved = await insertPendingDocument({
    id, userPhone: msg.phone, fileName, fileUrl, mimeType: mime, fileSize: data.length, contentHash,
  });
  if (!reserved) {
    const existing = await findByHash(msg.phone, contentHash);
    return { status: 'duplicate', documentId: existing?.id ?? '', fileName: existing?.titulo || existing?.file_name || fileName };
  }

  try {
    // 3) Storage do original.
    await storage.upload(fileUrl, data, mime);

    // 4) Extração de texto (sem custo de API).
    const text = await extractText(data, mime);

    // 5) Classificação + metadados em UMA chamada barata.
    const meta = await classifyDocument(text, fileName, msg.text);

    // 6) Chunking + embeddings em UMA chamada (cartão do documento + chunks).
    const chunks = chunkText(text, { size: env.CHUNK_SIZE, overlap: env.CHUNK_OVERLAP });
    const card = buildDocumentCard(meta, fileName, msg.text);
    const [cardVector, ...chunkVectors] = await embed([card, ...chunks]);

    // 7) Persistência atômica.
    const remindersCreated = await withTransaction(async (client) => {
      await insertChunks(
        client, id, msg.phone,
        chunks.map((content, i) => ({ content, tokenCount: estimateTokens(content), embedding: chunkVectors[i] })),
      );
      await completeDocument(client, {
        id,
        titulo: meta.titulo,
        categoria: meta.categoria,
        tags: meta.tags,
        resumo: meta.resumo,
        docDate: meta.dataReferencia,
        valorTotal: meta.valorTotal,
        searchText: card,
        embedding: cardVector,
      });
      let created = 0;
      for (const v of meta.vencimentos) {
        created += await createRemindersForDue(client, {
          userPhone: msg.phone,
          documentId: id,
          title: v.descricao,
          dueDate: v.data,
          daysBefore: env.REMINDER_DAYS_BEFORE,
          hour: env.REMINDER_HOUR,
          tz: env.REMINDER_TZ,
        });
      }
      return created;
    });

    logger.info({ id, chunks: chunks.length, categoria: meta.categoria, remindersCreated }, 'Documento indexado');
    return { status: 'saved', documentId: id, fileName, meta, remindersCreated, hasText: text.length >= 20 };
  } catch (err) {
    // Remove o registro para o usuário poder reenviar o mesmo arquivo.
    await deleteDocument(id).catch(() => undefined);
    throw err;
  }
}
