/**
 * Cliente OpenAI + wrappers com parâmetros enxutos (economia de tokens).
 * Para trocar de provedor (ex.: Anthropic Haiku), basta reimplementar `chat`.
 */
import OpenAI from 'openai';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

/** Limite de caracteres por input de embedding (~2k tokens; bem abaixo do máximo de 8k). */
const EMBEDDING_INPUT_MAX_CHARS = 8000;
const EMBEDDING_BATCH = 100;

/**
 * Gera embeddings em lote: 1 chamada HTTP para até 100 textos
 * (chunks + "cartão" do documento vão juntos na mesma chamada).
 */
export async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH).map((t) => t.slice(0, EMBEDDING_INPUT_MAX_CHARS) || ' ');
    const res = await openai.embeddings.create({ model: env.EMBEDDING_MODEL, input: batch });
    out.push(...res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
    logger.debug({ tokens: res.usage.total_tokens }, 'embeddings');
  }
  return out;
}

export interface ChatOptions {
  system: string;
  user: string;
  maxTokens: number;
  json?: boolean;
}

/** Chamada de chat com temperatura 0 e teto de tokens de saída. */
export async function chat({ system, user, maxTokens, json }: ChatOptions): Promise<string> {
  const res = await openai.chat.completions.create({
    model: env.CHAT_MODEL,
    temperature: 0,
    max_tokens: maxTokens,
    response_format: json ? { type: 'json_object' } : undefined,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  logger.info({ usage: res.usage, model: env.CHAT_MODEL }, 'llm usage');
  return res.choices[0]?.message?.content?.trim() ?? '';
}
