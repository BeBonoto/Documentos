/**
 * Testes de integração com Postgres + pgvector reais (OpenAI mockado).
 * Rode com: TEST_DATABASE_URL=postgres://... npm test   (após npm run migrate nesse banco)
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Embedding determinístico "bag of words": textos com palavras em comum ficam próximos.
function fakeEmbedding(text: string): number[] {
  const v = new Array(1536).fill(0);
  for (const w of text.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((x) => x.length > 2)) {
    const h = createHash('md5').update(w).digest().readUInt32BE(0);
    v[h % 1536] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

vi.mock('../src/lib/openai.js', () => ({
  embed: async (texts: string[]) => texts.map(fakeEmbedding),
  chat: async () => 'mock',
}));

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const PHONE = `55119${Date.now().toString().slice(-8)}`;

describe.skipIf(!enabled)('integração com Postgres', async () => {
  const { pool, withTransaction } = await import('../src/lib/db.js');
  const docs = await import('../src/repositories/documents.repo.js');
  const reminders = await import('../src/repositories/reminders.repo.js');
  const { searchDocuments, searchChunks } = await import('../src/search/hybrid.js');

  async function addDoc(o: { titulo: string; categoria: string; docDate: string; chunks: string[]; tags?: string[] }) {
    const id = randomUUID();
    const reserved = await docs.insertPendingDocument({
      id, userPhone: PHONE, fileName: `${o.titulo}.pdf`, fileUrl: `${PHONE}/${id}.pdf`,
      mimeType: 'application/pdf', fileSize: 10, contentHash: id,
    });
    expect(reserved).toBe(id);
    const card = [o.titulo, o.categoria, (o.tags ?? []).join(', ')].join(' | ');
    await withTransaction(async (c) => {
      await docs.insertChunks(c, id, PHONE, o.chunks.map((content) => ({ content, tokenCount: 10, embedding: fakeEmbedding(content) })));
      await docs.completeDocument(c, {
        id, titulo: o.titulo, categoria: o.categoria, tags: o.tags ?? [], resumo: '', docDate: o.docDate,
        valorTotal: null, searchText: card, embedding: fakeEmbedding(card),
      });
    });
    return id;
  }

  let luzJan: string;
  let luzFev: string;

  beforeAll(async () => {
    luzJan = await addDoc({ titulo: 'Conta de luz Enel janeiro', categoria: 'Moradia', docDate: '2026-01-10', tags: ['energia'], chunks: ['Conta de energia Enel. Total a pagar R$ 150,00. Referência janeiro.'] });
    luzFev = await addDoc({ titulo: 'Conta de luz Enel fevereiro', categoria: 'Moradia', docDate: '2026-02-10', tags: ['energia'], chunks: ['Conta de energia Enel. Total a pagar R$ 180,00. Referência fevereiro.'] });
    await addDoc({ titulo: 'Exame de sangue hemograma', categoria: 'Saúde', docDate: '2026-02-01', tags: ['exame'], chunks: ['Hemograma completo. Hemoglobina 14 g/dL.'] });
  });

  afterAll(async () => {
    await pool.query('delete from documents where user_phone = $1', [PHONE]);
    await pool.end();
  });

  it('dedup por hash', async () => {
    const again = await docs.insertPendingDocument({
      id: randomUUID(), userPhone: PHONE, fileName: 'x.pdf', fileUrl: 'x', mimeType: 'application/pdf', fileSize: 1, contentHash: luzJan,
    });
    expect(again).toBeNull();
  });

  it('busca de arquivo respeita o mês pedido', async () => {
    const hits = await searchDocuments(PHONE, 'me manda a conta de luz de janeiro de 2026');
    expect(hits[0].id).toBe(luzJan);
  });

  it('busca de arquivo com "última" prioriza o mais recente', async () => {
    const hits = await searchDocuments(PHONE, 'manda a última conta de luz');
    expect(hits[0].id).toBe(luzFev);
  });

  it('RAG com "última" usa só chunks do documento mais recente', async () => {
    const hits = await searchChunks(PHONE, 'quanto paguei na última conta de energia Enel?', 4);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.document_id === luzFev)).toBe(true);
  });

  it('listagem por categoria', async () => {
    const list = await docs.listDocuments(PHONE, { categoria: 'Moradia', limit: 10 });
    expect(list.map((d) => d.id)).toEqual([luzFev, luzJan]);
  });

  it('lembretes: cria D-N e D-0 no fuso, ignora passado e é idempotente', async () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const input = { userPhone: PHONE, documentId: luzFev, title: 'Boleto Enel', dueDate: future, daysBefore: 3, hour: 9, tz: 'America/Sao_Paulo' };
    const created = await withTransaction((c) => reminders.createRemindersForDue(c, input));
    expect(created).toBe(2);
    expect(await withTransaction((c) => reminders.createRemindersForDue(c, input))).toBe(0);
    expect(await withTransaction((c) => reminders.createRemindersForDue(c, { ...input, dueDate: '2020-01-01' }))).toBe(0);

    const { rows } = await pool.query(
      `select to_char(remind_at at time zone 'America/Sao_Paulo', 'HH24:MI') as hora from reminders where document_id = $1`,
      [luzFev],
    );
    expect(rows.every((r) => r.hora === '09:00')).toBe(true);

    // Força um lembrete vencido e verifica o "claim" atômico.
    await pool.query(`update reminders set remind_at = remind_at - interval '20 days' where document_id = $1 and due_date = $2`, [luzFev, future]);
    const claimed = await reminders.claimDueReminders(50);
    expect(claimed.filter((r) => r.document_id === luzFev).length).toBe(2);
    for (const r of claimed) await reminders.markSent(r.id);
    expect((await reminders.listUpcoming(PHONE)).length).toBe(1);
  });
});
