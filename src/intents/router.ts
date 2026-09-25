/**
 * Roteador de intenção em 2 estágios:
 *   1) regras (0 tokens) — resolve ~90% das mensagens;
 *   2) fallback com LLM minúsculo (~80 tokens in / 1-2 tokens out) só se ambíguo.
 */
import { env } from '../config/env.js';
import { chat } from '../lib/openai.js';
import { logger } from '../lib/logger.js';
import { classifyByRules, type Intent, type RuleInput } from './rules.js';

const FALLBACK_SYSTEM =
  'Classifique a mensagem de um usuário de um bot de documentos pessoais. ' +
  'Responda SOMENTE uma palavra: ARQUIVO (quer receber um arquivo), PERGUNTA (quer uma informação do conteúdo) ou LISTA (quer ver seus documentos).';

export async function routeIntent(input: RuleInput): Promise<Intent> {
  const byRules = classifyByRules(input);
  if (byRules) return byRules;

  const query = input.text.trim();
  if (!env.LLM_INTENT_FALLBACK) return { type: 'ASK', query };

  try {
    const label = (await chat({ system: FALLBACK_SYSTEM, user: query.slice(0, 300), maxTokens: 3 })).toUpperCase();
    if (label.startsWith('ARQ')) return { type: 'FETCH', query };
    if (label.startsWith('LIS')) return { type: 'LIST' };
  } catch (err) {
    logger.warn({ err }, 'Fallback de intenção falhou; assumindo PERGUNTA');
  }
  return { type: 'ASK', query };
}
