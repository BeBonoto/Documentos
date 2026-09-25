import type { DocRef } from '../lib/session.js';
import { storage } from '../storage/storage.js';
import { sendMedia } from '../whatsapp/evolution.client.js';

/** Envia o arquivo original via URL assinada de curta duração (sem passar pelo LLM). */
export async function sendDocument(phone: string, doc: DocRef, caption?: string): Promise<void> {
  const url = await storage.signedUrl(doc.fileUrl);
  await sendMedia(phone, { media: url, mimetype: doc.mimeType, fileName: doc.fileName, caption });
}
