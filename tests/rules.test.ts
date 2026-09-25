import { describe, expect, it } from 'vitest';
import { classifyByRules } from '../src/intents/rules.js';

const route = (text: string, hasMedia = false) => classifyByRules({ text, hasMedia });

describe('classifyByRules', () => {
  it('mídia sempre é ADD', () => {
    expect(route('conta de luz', true)).toEqual({ type: 'ADD' });
  });

  it('pedidos de arquivo viram FETCH', () => {
    expect(route('me manda a conta de luz de janeiro')?.type).toBe('FETCH');
    expect(route('Envia o contrato do aluguel')?.type).toBe('FETCH');
    expect(route('cadê o comprovante do pix?')?.type).toBe('FETCH');
  });

  it('perguntas viram ASK', () => {
    expect(route('quanto paguei na última conta de luz?')?.type).toBe('ASK');
    expect(route('Qual o vencimento do IPVA')?.type).toBe('ASK');
    expect(route('o exame deu alteração?')?.type).toBe('ASK');
  });

  it('comandos', () => {
    expect(route('/listar financas')).toEqual({ type: 'LIST', categoria: 'financas' });
    expect(route('/ultimos')).toEqual({ type: 'LIST', limit: 5 });
    expect(route('/ultimos 50')).toEqual({ type: 'LIST', limit: 20 });
    expect(route('/lembretes')).toEqual({ type: 'REMINDERS' });
    expect(route('/xyz')).toEqual({ type: 'HELP' });
  });

  it('listagem em linguagem natural', () => {
    expect(route('quais são meus documentos')?.type).toBe('LIST');
  });

  it('número escolhe item da lista', () => {
    expect(route('2')).toEqual({ type: 'PICK', index: 2 });
  });

  it('lembretes em linguagem natural', () => {
    expect(route('meus vencimentos')).toEqual({ type: 'REMINDERS' });
    expect(route('o que vence essa semana?')).toEqual({ type: 'REMINDERS' });
  });

  it('saudação vira HELP', () => {
    expect(route('Oi')).toEqual({ type: 'HELP' });
  });

  it('mensagem ambígua retorna null (vai para o fallback)', () => {
    expect(route('contrato de aluguel')).toBeNull();
  });
});
