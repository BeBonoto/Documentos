/** Datas: parsing de meses em PT-BR e formatação (funções puras). */

export const MONTHS = [
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' */
export function formatBR(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** Valida 'YYYY-MM-DD' (e se é uma data real). */
export function isValidISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= lastDayOfMonth(y, m) && y > 1900 && y < 2200;
}

/** Data de hoje (YYYY-MM-DD) em um fuso específico. */
export function todayInTz(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
