import { describe, expect, it } from 'vitest';
import { parseQuery } from '../src/search/queryParser.js';

const MARCH_2026 = new Date(2026, 2, 15);

describe('parseQuery', () => {
  it('extrai mês, categoria e termos', () => {
    const q = parseQuery('me manda a conta de luz de janeiro', MARCH_2026);
    expect(q.categoria).toBe('Moradia');
    expect(q.dateFrom).toBe('2026-01-01');
    expect(q.dateTo).toBe('2026-01-31');
    expect(q.terms).toEqual(['conta', 'luz']);
    expect(q.latest).toBe(false);
  });

  it('mês futuro sem ano aponta para o ano anterior', () => {
    const q = parseQuery('fatura de dezembro', MARCH_2026);
    expect(q.dateFrom).toBe('2025-12-01');
  });

  it('mês/ano numérico e fevereiro bissexto', () => {
    const q = parseQuery('boleto 02/2028', MARCH_2026);
    expect(q.dateFrom).toBe('2028-02-01');
    expect(q.dateTo).toBe('2028-02-29');
  });

  it('detecta "último"', () => {
    const q = parseQuery('quanto paguei na última conta de água?', MARCH_2026);
    expect(q.latest).toBe(true);
    expect(q.categoria).toBe('Moradia');
  });

  it('apenas ano', () => {
    const q = parseQuery('IPVA 2025', MARCH_2026);
    expect(q.dateFrom).toBe('2025-01-01');
    expect(q.categoria).toBe('Veículos');
  });
});
