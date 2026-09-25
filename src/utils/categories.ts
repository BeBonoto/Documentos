/** Taxonomia fixa de categorias (enviada ao LLM como enum e usada nos comandos). */
import { normalize } from './text.js';

export const CATEGORIES = [
  'Finanças',
  'Moradia',
  'Saúde',
  'Contratos',
  'Veículos',
  'Impostos',
  'Identidade',
  'Educação',
  'Trabalho',
  'Outros',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Palavras-chave (normalizadas) que sugerem uma categoria — usadas SEM LLM na busca. */
const KEYWORDS: Record<Exclude<Category, 'Outros'>, string[]> = {
  Finanças: ['financa', 'financas', 'banco', 'extrato', 'fatura', 'cartao', 'boleto', 'comprovante', 'pix', 'transferencia', 'investimento', 'emprestimo'],
  Moradia: ['luz', 'energia', 'agua', 'gas', 'internet', 'aluguel', 'condominio', 'moradia', 'casa', 'apartamento'],
  Saúde: ['saude', 'exame', 'receita', 'medico', 'consulta', 'vacina', 'laudo', 'hospital', 'plano de saude', 'dentista'],
  Contratos: ['contrato', 'contratos', 'acordo', 'termo', 'procuracao'],
  Veículos: ['carro', 'moto', 'veiculo', 'veiculos', 'ipva', 'licenciamento', 'crlv', 'multa', 'detran', 'seguro auto'],
  Impostos: ['imposto', 'impostos', 'irpf', 'darf', 'iptu', 'imposto de renda', 'receita federal'],
  Identidade: ['rg', 'cpf', 'cnh', 'passaporte', 'certidao', 'titulo de eleitor', 'identidade'],
  Educação: ['escola', 'faculdade', 'diploma', 'certificado', 'boletim escolar', 'mensalidade', 'educacao', 'curso'],
  Trabalho: ['holerite', 'contracheque', 'ctps', 'ferias', 'rescisao', 'salario', 'trabalho', 'fgts'],
};

/** Detecta categoria por palavra-chave em um texto livre (ou null). */
export function detectCategory(text: string): Category | null {
  const norm = ` ${normalize(text).replace(/[^a-z0-9\s]/g, ' ')} `;
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    if (words.some((w) => norm.includes(` ${w} `))) return cat as Category;
  }
  return null;
}

/** Resolve argumento de comando (ex.: "financas", "saude") para a categoria oficial. */
export function resolveCategoryArg(arg: string): Category | null {
  const a = normalize(arg);
  if (!a) return null;
  const direct = CATEGORIES.find((c) => normalize(c).startsWith(a) || a.startsWith(normalize(c)));
  return direct ?? detectCategory(a);
}

/** Garante que um valor vindo do LLM seja uma categoria válida. */
export function coerceCategory(value: unknown): Category {
  if (typeof value !== 'string') return 'Outros';
  return CATEGORIES.find((c) => normalize(c) === normalize(value)) ?? resolveCategoryArg(value) ?? 'Outros';
}
