import { describe, expect, it } from 'vitest';
import { chunkText } from '../src/pipeline/chunk.js';
import { truncateHeadTail } from '../src/utils/text.js';

describe('chunkText', () => {
  it('texto curto vira um único chunk', () => {
    expect(chunkText('Conta de luz: R$ 120,00', { size: 100, overlap: 10 })).toEqual(['Conta de luz: R$ 120,00']);
  });

  it('respeita o tamanho aproximado e cobre todo o texto', () => {
    const paras = Array.from({ length: 20 }, (_, i) => `Parágrafo ${i} ` + 'x'.repeat(80));
    const chunks = chunkText(paras.join('\n\n'), { size: 300, overlap: 30 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(300 + 30 + 2);
    expect(chunks.join(' ')).toContain('Parágrafo 19');
  });

  it('texto vazio não gera chunks', () => {
    expect(chunkText('   ', { size: 100, overlap: 10 })).toEqual([]);
  });
});

describe('truncateHeadTail', () => {
  it('mantém início e fim', () => {
    const t = truncateHeadTail('A'.repeat(100) + 'TOTAL', 40);
    expect(t.startsWith('AAA')).toBe(true);
    expect(t.endsWith('TOTAL')).toBe(true);
  });
});
