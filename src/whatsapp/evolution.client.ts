/**
 * Cliente HTTP mínimo da Evolution API v2.
 * Docs: https://doc.evolution-api.com/v2/api-reference
 */
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

const baseUrl = env.EVOLUTION_API_URL.replace(/\/$/, '');

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}/${encodeURIComponent(env.EVOLUTION_INSTANCE)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.EVOLUTION_API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Evolution API ${path} falhou: ${res.status} ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export async function sendText(phone: string, text: string): Promise<void> {
  await call('/message/sendText', { number: phone, text });
}

export interface SendMediaInput {
  /** URL pública/assinada (a Evolution baixa o arquivo) ou base64 puro. */
  media: string;
  mimetype: string;
  fileName: string;
  caption?: string;
}

export async function sendMedia(phone: string, input: SendMediaInput): Promise<void> {
  await call('/message/sendMedia', {
    number: phone,
    mediatype: input.mimetype.startsWith('image/') ? 'image' : 'document',
    mimetype: input.mimetype,
    media: input.media,
    fileName: input.fileName,
    caption: input.caption,
  });
}

/** Baixa a mídia de uma mensagem recebida (quando o webhook não traz base64). */
export async function downloadMedia(messageId: string): Promise<{ base64: string; mimetype?: string; fileName?: string }> {
  const res = await call<{ base64: string; mimetype?: string; fileName?: string }>('/chat/getBase64FromMediaMessage', {
    message: { key: { id: messageId } },
    convertToMp4: false,
  });
  if (!res?.base64) throw new Error('Evolution API não retornou o base64 da mídia');
  return res;
}

/** Envio "best effort" para mensagens de status (não derruba o fluxo se falhar). */
export async function safeSendText(phone: string, text: string): Promise<void> {
  try {
    await sendText(phone, text);
  } catch (err) {
    logger.error({ err, phone }, 'Falha ao enviar mensagem');
  }
}
