/** Tipos mínimos do webhook `messages.upsert` da Evolution API v2 (Baileys). */

export interface EvolutionMediaMessage {
  mimetype?: string;
  fileName?: string;
  caption?: string;
  fileLength?: string | number;
}

export interface EvolutionMessageContent {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  documentMessage?: EvolutionMediaMessage;
  imageMessage?: EvolutionMediaMessage;
  documentWithCaptionMessage?: { message?: EvolutionMessageContent };
  ephemeralMessage?: { message?: EvolutionMessageContent };
  viewOnceMessage?: { message?: EvolutionMessageContent };
  viewOnceMessageV2?: { message?: EvolutionMessageContent };
  /** Presente quando a instância está com "webhook_base64" habilitado. */
  base64?: string;
}

export interface EvolutionWebhook {
  event: string;
  instance: string;
  data?: {
    key?: {
      id: string;
      remoteJid: string;
      fromMe?: boolean;
      /** Número real quando o remoteJid vem como @lid (WhatsApp mais recente). */
      remoteJidAlt?: string;
      senderPn?: string;
    };
    pushName?: string;
    message?: EvolutionMessageContent;
    messageType?: string;
  };
}

/** Mensagem normalizada, independente do provedor de WhatsApp. */
export interface IncomingMessage {
  id: string;
  phone: string;
  pushName?: string;
  text: string;
  media?: {
    kind: 'document' | 'image';
    mimetype: string;
    fileName?: string;
    base64?: string;
  };
}
