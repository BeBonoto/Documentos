/**
 * Classificação + extração de metadados em UMA única chamada ao LLM,
 * com texto truncado (início + fim) e saída JSON compacta.
 */
import { z } from 'zod';
import { env } from '../config/env.js';
import { chat } from '../lib/openai.js';
import { logger } from '../lib/logger.js';
import { CATEGORIES, coerceCategory, detectCategory, type Category } from '../utils/categories.js';
import { isValidISODate, todayInTz } from '../utils/dates.js';
import { truncateHeadTail } from '../utils/text.js';

export interface DocumentMetadata {
  categoria: Category;
  tags: string[];
  resumo: string;
  titulo: string;
  dataReferencia: string | null;
  valorTotal: number | null;
  vencimentos: { descricao: string; data: string }[];
}

const SYSTEM =
  'Você extrai metadados de documentos pessoais brasileiros (contas, boletos, exames, contratos, comprovantes). ' +
  'Responda APENAS com JSON válido, sem comentários.';

// Schema tolerante: o que vier inválido é descartado em vez de quebrar o fluxo.
const llmSchema = z.object({
  categoria: z.string().optional(),
  tags: z.array(z.string()).optional().catch([]),
  resumo: z.string().optional().catch(''),
  titulo: z.string().optional().catch(''),
  data_referencia: z.string().nullable().optional().catch(null),
  valor_total: z.number().nullable().optional().catch(null),
  vencimentos: z
    .array(z.object({ descricao: z.string().catch(''), data: z.string() }))
    .optional()
    .catch([]),
});

function buildPrompt(text: string, fileName: string, caption: string): string {
  return [
    `Categorias: ${CATEGORIES.join('|')}`,
    `Hoje: ${todayInTz(env.REMINDER_TZ)}`,
    `Arquivo: ${fileName}`,
    caption ? `Legenda do usuário: ${caption.slice(0, 200)}` : '',
    `Texto:\n"""\n${truncateHeadTail(text, env.CLASSIFY_MAX_CHARS)}\n"""`,
    'Retorne: {"categoria":"<uma das categorias>","titulo":"<nome curto, ex: Conta de luz jan/2025>",' +
      '"tags":["<até 5, minúsculas>"],"resumo":"<até 160 caracteres>",' +
      '"data_referencia":"<YYYY-MM-DD da competência/emissão ou null>","valor_total":<número ou null>,' +
      '"vencimentos":[{"descricao":"<ex: Boleto Enel>","data":"YYYY-MM-DD"}]}',
    'Inclua em vencimentos apenas datas de pagamento/renovação/expiração futuras ou do documento.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Fallback sem LLM (texto vazio ou erro): usa nome do arquivo/legenda. */
function heuristicMetadata(fileName: string, caption: string): DocumentMetadata {
  const hint = `${fileName} ${caption}`;
  return {
    categoria: detectCategory(hint) ?? 'Outros',
    tags: [],
    resumo: caption.slice(0, 160),
    titulo: caption.slice(0, 60) || fileName,
    dataReferencia: null,
    valorTotal: null,
    vencimentos: [],
  };
}

export async function classifyDocument(text: string, fileName: string, caption = ''): Promise<DocumentMetadata> {
  // Sem texto não há o que classificar — não gaste tokens.
  if (text.trim().length < 20) return heuristicMetadata(fileName, caption);

  try {
    const raw = await chat({ system: SYSTEM, user: buildPrompt(text, fileName, caption), maxTokens: 350, json: true });
    const parsed = llmSchema.parse(JSON.parse(raw));
    return {
      categoria: coerceCategory(parsed.categoria),
      tags: [...new Set((parsed.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean))].slice(0, 5),
      resumo: (parsed.resumo ?? '').slice(0, 200),
      titulo: (parsed.titulo || fileName).slice(0, 80),
      dataReferencia: isValidISODate(parsed.data_referencia) ? parsed.data_referencia : null,
      valorTotal: typeof parsed.valor_total === 'number' && Number.isFinite(parsed.valor_total) ? parsed.valor_total : null,
      vencimentos: (parsed.vencimentos ?? [])
        .filter((v) => isValidISODate(v.data))
        .map((v) => ({ descricao: (v.descricao || 'Vencimento').slice(0, 80), data: v.data }))
        .slice(0, 5),
    };
  } catch (err) {
    logger.warn({ err }, 'Classificação via LLM falhou; usando heurística');
    return heuristicMetadata(fileName, caption);
  }
}
