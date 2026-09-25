/**
 * Dispatcher principal: autorização -> intenção -> handler.
 */
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { routeIntent } from '../intents/router.js';
import { safeSendText } from '../whatsapp/evolution.client.js';
import type { IncomingMessage } from '../whatsapp/types.js';
import { handleAdd } from './add.handler.js';
import { handleAsk } from './ask.handler.js';
import { handleFetch } from './fetch.handler.js';
import { handleList } from './list.handler.js';
import { handleHelp, handlePick, handleReminders } from './misc.handler.js';

export async function handleIncoming(msg: IncomingMessage): Promise<void> {
  if (env.ALLOWED_PHONES.length && !env.ALLOWED_PHONES.includes(msg.phone)) {
    logger.warn({ phone: msg.phone }, 'Número não autorizado — ignorando');
    return;
  }

  const intent = await routeIntent({ text: msg.text, hasMedia: Boolean(msg.media) });
  logger.info({ phone: msg.phone, intent: intent.type }, 'Mensagem roteada');

  try {
    switch (intent.type) {
      case 'ADD':
        return await handleAdd(msg);
      case 'FETCH':
        return await handleFetch(msg.phone, intent.query);
      case 'ASK':
        return await handleAsk(msg.phone, intent.query);
      case 'LIST':
        return await handleList(msg.phone, intent);
      case 'PICK':
        return await handlePick(msg.phone, intent.index);
      case 'REMINDERS':
        return await handleReminders(msg.phone);
      case 'HELP':
        return await handleHelp(msg.phone);
    }
  } catch (err) {
    logger.error({ err, intent: intent.type, phone: msg.phone }, 'Erro ao processar mensagem');
    await safeSendText(msg.phone, '😕 Tive um problema para processar sua mensagem. Tente novamente em instantes.');
  }
}
