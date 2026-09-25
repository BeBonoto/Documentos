/**
 * Roteador de intenção baseado em regras (0 tokens). Resolve a grande maioria
 * das mensagens; só o que for ambíguo cai no fallback com LLM (ver router.ts).
 */
import { normalize } from '../utils/text.js';

export type Intent =
  | { type: 'ADD' }
  | { type: 'FETCH'; query: string }
  | { type: 'ASK'; query: string }
  | { type: 'LIST'; categoria?: string; limit?: number }
  | { type: 'PICK'; index: number }
  | { type: 'REMINDERS' }
  | { type: 'HELP' };

export interface RuleInput {
  text: string;
  hasMedia: boolean;
}

const GREETING_RE = /^(oi+|ola|opa|e ai|bom dia|boa tarde|boa noite|ajuda|help|menu|comandos|inicio|start)\b/;
const LIST_RE =
  /\b(listar|liste|lista( de)? (meus )?(documentos|arquivos)|mostr[ae] (meus|os|todos|minhas)|quais (sao )?(os )?(meus )?(documentos|arquivos)|meus (documentos|arquivos))\b/;
const FETCH_RE =
  /\b(manda|mande|mandar|envia|envie|enviar|encaminha|encaminhe|baixar|baixa|download|me (passa|passe|da|de)|quero (o|a|ver o|ver a) |preciso (do|da) |cade|segunda via|2a via)\b/;
const QUESTION_START_RE =
  /^(quanto|quantos|quantas|qual|quais|quando|quem|onde|como|o que|oque|por que|porque|que dia|ate quando|resuma|resume|explique|explica|me explica|me diz|me diga)\b/;
const REMINDERS_RE =
  /^((meus|ver|mostrar?) )?(lembretes|vencimentos)$|\b(o que vence|contas a vencer|proximos vencimentos)\b/;

export function classifyByRules({ text, hasMedia }: RuleInput): Intent | null {
  // 1) Mídia sempre é um novo documento (a legenda vira dica para a classificação).
  if (hasMedia) return { type: 'ADD' };

  const raw = text.trim();
  const norm = normalize(raw);
  if (!norm) return { type: 'HELP' };

  // 2) Comandos explícitos com barra.
  if (norm.startsWith('/')) return parseCommand(norm);

  // 3) Número solto = escolher item da última lista enviada.
  const pick = norm.match(/^#?(\d{1,2})$/);
  if (pick) return { type: 'PICK', index: Number(pick[1]) };

  if (GREETING_RE.test(norm) && norm.split(' ').length <= 3) return { type: 'HELP' };
  if (REMINDERS_RE.test(norm)) return { type: 'REMINDERS' };
  if (LIST_RE.test(norm)) return { type: 'LIST' };

  // 4) Pergunta explícita vence verbo de pedido ("qual o valor... me manda?" -> pergunta).
  if (QUESTION_START_RE.test(norm)) return { type: 'ASK', query: raw };
  if (FETCH_RE.test(norm)) return { type: 'FETCH', query: raw };
  if (raw.endsWith('?')) return { type: 'ASK', query: raw };

  return null; // ambíguo
}

export function parseCommand(norm: string): Intent {
  const [cmd, ...rest] = norm.slice(1).split(' ');
  const arg = rest.join(' ').trim();
  switch (cmd) {
    case 'listar':
    case 'lista':
    case 'list':
      return { type: 'LIST', categoria: arg || undefined };
    case 'ultimos':
    case 'recentes': {
      const n = Number(arg);
      return { type: 'LIST', limit: Number.isFinite(n) && n > 0 ? Math.min(n, 20) : 5 };
    }
    case 'lembretes':
    case 'vencimentos':
      return { type: 'REMINDERS' };
    case 'buscar':
    case 'baixar':
      return arg ? { type: 'FETCH', query: arg } : { type: 'HELP' };
    case 'perguntar':
      return arg ? { type: 'ASK', query: arg } : { type: 'HELP' };
    default:
      return { type: 'HELP' };
  }
}
