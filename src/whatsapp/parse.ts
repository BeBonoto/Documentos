/** Converte o payload da Evolution API em uma IncomingMessage (função pura). */
import type { EvolutionMessageContent, EvolutionWebhook, IncomingMessage } from './types.js';

/** Desembrulha mensagens aninhadas (com legenda, temporárias, visualização única). */
function unwrap(msg: EvolutionMessageContent): EvolutionMessageContent {
  const inner =
    msg.documentWithCaptionMessage?.message ??
    msg.ephemeralMessage?.message ??
    msg.viewOnceMessage?.message ??
    msg.viewOnceMessageV2?.message;
  return inner ? { ...unwrap(inner), base64: msg.base64 ?? inner.base64 } : msg;
}

const jidToPhone = (jid: string) => jid.split('@')[0].split(':')[0].replace(/\D/g, '');

export function parseEvolutionWebhook(body: EvolutionWebhook): IncomingMessage | null {
  if (body?.event !== 'messages.upsert' || !body.data?.key || !body.data.message) return null;
  const { key, message: rawMessage, pushName } = body.data;

  // Ignora mensagens enviadas pelo próprio bot, grupos e status.
  if (key.fromMe) return null;
  if (key.remoteJid.endsWith('@g.us') || key.remoteJid === 'status@broadcast') return null;

  const jid = key.remoteJid.endsWith('@lid') ? (key.remoteJidAlt ?? key.senderPn ?? key.remoteJid) : key.remoteJid;
  const phone = jidToPhone(jid);
  if (!phone) return null;

  const msg = unwrap(rawMessage);
  const doc = msg.documentMessage;
  const img = msg.imageMessage;

  const text = (msg.conversation ?? msg.extendedTextMessage?.text ?? doc?.caption ?? img?.caption ?? '').trim();

  let media: IncomingMessage['media'];
  if (doc) {
    media = { kind: 'document', mimetype: doc.mimetype ?? 'application/octet-stream', fileName: doc.fileName, base64: msg.base64 };
  } else if (img) {
    media = { kind: 'image', mimetype: img.mimetype ?? 'image/jpeg', base64: msg.base64 };
  }

  if (!text && !media) return null; // áudio, figurinha, reação etc.
  return { id: key.id, phone, pushName, text, media };
}
