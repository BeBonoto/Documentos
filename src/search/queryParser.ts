/**
 * Extrai filtros estruturados de uma frase livre SEM usar LLM (0 tokens):
 *   "me manda a conta de luz de janeiro" -> { categoria: 'Moradia', dateFrom: '2026-01-01', dateTo: '2026-01-31', terms: ['conta','luz'] }
 */
import { detectCategory, type Category } from '../utils/categories.js';
import { MONTHS, lastDayOfMonth, toISODate } from '../utils/dates.js';
import { keywords, normalize } from '../utils/text.js';

export interface ParsedQuery {
  categoria: Category | null;
  dateFrom: string | null;
  dateTo: string | null;
  /** Usuário pediu "o último"/"a mais recente". */
  latest: boolean;
  /** Termos relevantes para o full-text search (sem stopwords, meses e anos). */
  terms: string[];
}

export function parseQuery(text: string, now = new Date()): ParsedQuery {
  const norm = normalize(text);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Mês por extenso ("janeiro") ou numérico ("01/2025", "1/25").
  let month: number | null = null;
  let year: number | null = null;

  const monthIdx = MONTHS.findIndex((m) => new RegExp(`\\b${m}\\b`).test(norm));
  if (monthIdx >= 0) month = monthIdx + 1;

  const numeric = norm.match(/\b(0?[1-9]|1[0-2])\/(20\d{2}|\d{2})\b/);
  if (numeric) {
    month = Number(numeric[1]);
    year = numeric[2].length === 2 ? 2000 + Number(numeric[2]) : Number(numeric[2]);
  }

  const yearMatch = norm.match(/\b(20\d{2})\b/);
  if (!year && yearMatch) year = Number(yearMatch[1]);

  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  if (month) {
    // Mês sem ano => ocorrência mais recente desse mês (ex.: em março, "dezembro" = ano passado).
    const y = year ?? (month > currentMonth ? currentYear - 1 : currentYear);
    dateFrom = toISODate(y, month, 1);
    dateTo = toISODate(y, month, lastDayOfMonth(y, month));
  } else if (year) {
    dateFrom = toISODate(year, 1, 1);
    dateTo = toISODate(year, 12, 31);
  }

  const latest = /\b(ultim[oa]s?|mais recente|atual|deste mes|desse mes)\b/.test(norm);

  const terms = keywords(text).filter(
    (w) => !MONTHS.includes(w) && !/^\d+$/.test(w) && !/^\d{1,2}\/\d{2,4}$/.test(w),
  );

  return { categoria: detectCategory(text), dateFrom, dateTo, latest, terms };
}
