import { describe, expect, it } from 'vitest';
import { parseEvolutionWebhook } from '../src/whatsapp/parse.js';
import { resolveCategoryArg } from '../src/utils/categories.js';

const base = { event: 'messages.upsert', instance: 'bot' };

describe('parseEvolutionWebhook', () => {
  it('texto simples', () => {
    const msg = parseEvolutionWebhook({
      ...base,
      data: { key: { id: 'A1', remoteJid: '5511999999999@s.whatsapp.net' }, message: { conversation: ' oi ' } },
    });
    expect(msg).toEqual({ id: 'A1', phone: '5511999999999', pushName: undefined, text: 'oi', media: undefined });
  });

  it('documento com legenda (mensagem aninhada)', () => {
    const msg = parseEvolutionWebhook({
      ...base,
      data: {
        key: { id: 'A2', remoteJid: '5511999999999@s.whatsapp.net' },
        message: {
          documentWithCaptionMessage: {
            message: { documentMessage: { mimetype: 'application/pdf', fileName: 'luz.pdf', caption: 'luz jan' } },
          },
        },
      },
    });
    expect(msg?.text).toBe('luz jan');
    expect(msg?.media).toMatchObject({ kind: 'document', mimetype: 'application/pdf', fileName: 'luz.pdf' });
  });

  it('ignora mensagens próprias e de grupos', () => {
    const fromMe = { ...base, data: { key: { id: 'x', remoteJid: '1@s.whatsapp.net', fromMe: true }, message: { conversation: 'a' } } };
    const group = { ...base, data: { key: { id: 'y', remoteJid: '123@g.us' }, message: { conversation: 'a' } } };
    expect(parseEvolutionWebhook(fromMe)).toBeNull();
    expect(parseEvolutionWebhook(group)).toBeNull();
  });

  it('usa o número alternativo quando o jid é @lid', () => {
    const msg = parseEvolutionWebhook({
      ...base,
      data: { key: { id: 'z', remoteJid: '9999@lid', remoteJidAlt: '5521988887777@s.whatsapp.net' }, message: { conversation: 'oi' } },
    });
    expect(msg?.phone).toBe('5521988887777');
  });
});

describe('resolveCategoryArg', () => {
  it('aceita sem acento e sinônimos', () => {
    expect(resolveCategoryArg('financas')).toBe('Finanças');
    expect(resolveCategoryArg('saude')).toBe('Saúde');
    expect(resolveCategoryArg('carro')).toBe('Veículos');
    expect(resolveCategoryArg('banana')).toBeNull();
  });
});
