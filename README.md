# 📂 Organizador Inteligente de Documentos (WhatsApp + RAG)

MVP de um bot de WhatsApp que **guarda, classifica, busca e responde perguntas** sobre documentos pessoais (PDFs, fotos de comprovantes e DOCX), gastando o mínimo possível de tokens.

| Camada        | Escolha                                                       |
| ------------- | ------------------------------------------------------------- |
| WhatsApp      | Evolution API v2 (Baileys) via webhook                        |
| Backend       | Node.js 22 + TypeScript + Fastify                             |
| Banco/vetores | Postgres + **pgvector** (Supabase ou Docker local)            |
| Arquivos      | Supabase Storage (bucket privado) ou disco local (dev)        |
| Extração      | `unpdf` (PDF com texto), Tesseract.js + poppler (OCR), mammoth (DOCX) |
| Embeddings    | `text-embedding-3-small` (1536 dims)                          |
| LLM           | `gpt-4o-mini` (classificação + respostas curtas)              |
| Lembretes     | Tabela `reminders` + polling com `FOR UPDATE SKIP LOCKED`     |

---

## 1. Estrutura do projeto

```
.
├── db/
│   ├── migrations/001_init.sql     # documents, chunks (pgvector), reminders
│   └── docker-init/                # cria o banco da Evolution no compose local
├── src/
│   ├── index.ts                    # bootstrap: HTTP + agendador de lembretes
│   ├── server.ts                   # Fastify: /health, /webhook/evolution, /files/*
│   ├── config/env.ts               # variáveis validadas com zod (falha rápido)
│   ├── lib/
│   │   ├── db.ts                   # pool pg + helpers pgvector/transação
│   │   ├── openai.ts               # embed() em lote + chat() com teto de tokens
│   │   ├── queue.ts                # fila em memória + deduplicação de mensagens
│   │   ├── session.ts              # "última lista" p/ responder só com o número
│   │   └── logger.ts
│   ├── whatsapp/
│   │   ├── webhook.ts              # rota do webhook (ACK imediato + fila)
│   │   ├── parse.ts                # payload Evolution -> IncomingMessage
│   │   ├── evolution.client.ts     # sendText / sendMedia / downloadMedia
│   │   └── types.ts
│   ├── intents/
│   │   ├── rules.ts                # roteador por regras (0 tokens)
│   │   └── router.ts               # fallback com LLM só p/ mensagens ambíguas
│   ├── handlers/                   # um handler por intenção
│   │   ├── index.ts                # dispatcher
│   │   ├── add.handler.ts          # ADICIONAR
│   │   ├── fetch.handler.ts        # BAIXAR ARQUIVO (sem LLM)
│   │   ├── ask.handler.ts          # PERGUNTA (RAG enxuto)
│   │   ├── list.handler.ts         # LISTAR (/listar, /ultimos) (sem LLM)
│   │   ├── misc.handler.ts         # escolher nº da lista, /lembretes, ajuda
│   │   ├── send.ts / format.ts
│   ├── pipeline/
│   │   ├── ingest.ts               # orquestra a ingestão
│   │   ├── extract.ts              # PDF / OCR / DOCX / TXT
│   │   ├── classify.ts             # categoria, tags, resumo, datas, valor (1 chamada)
│   │   └── chunk.ts
│   ├── search/
│   │   ├── queryParser.ts          # mês/ano/categoria/"último" por regex (0 tokens)
│   │   └── hybrid.ts               # vetorial + full-text + boosts, tudo em SQL
│   ├── repositories/               # SQL de documents/chunks/reminders
│   ├── reminders/scheduler.ts      # envia lembretes vencidos
│   ├── storage/storage.ts          # drivers supabase | local (URL assinada HMAC)
│   ├── utils/                      # texto, datas, categorias
│   └── scripts/migrate.ts          # runner de migrations
├── tests/                          # unitários + integração (Postgres real)
├── Dockerfile
├── docker-compose.yml              # postgres+pgvector, evolution-api, app
└── .env.example
```

## 2. Fluxos

```
WhatsApp ──► Evolution API ──► POST /webhook/evolution?token=…
                                   │ (200 imediato, dedup por message.id)
                                   ▼
                          fila (concorrência N)
                                   │
                    roteador de intenção (regras → LLM só se ambíguo)
     ┌───────────────┬─────────────┼──────────────┬──────────────────┐
   ADD            FETCH           ASK           LIST/PICK         REMINDERS
    │               │              │               │                  │
 download        busca híbrida   busca chunks   SQL simples        SQL simples
 sha256 dedup    (doc-level)     top-k + limiar    │                  │
 storage         URL assinada    prompt enxuto  lista numerada     lista
 extração        sendMedia       gpt-4o-mini    "responda 2"
 classifica(1x)  (0 tokens)      (≤300 out)     (0 tokens)        (0 tokens)
 chunks+embed(1x)
 lembretes
```

### Pipeline de ingestão (`src/pipeline/ingest.ts`)
1. **Download**: usa o base64 do webhook ou `POST /chat/getBase64FromMediaMessage`.
2. **Dedup**: `sha256` + `unique(user_phone, content_hash)`, então o mesmo arquivo nunca é reprocessado.
3. **Storage**: o original vai para o bucket privado com a chave `{telefone}/{uuid}.{ext}`.
4. **Extração**: PDF com texto via `unpdf`. Se o PDF tiver pouco texto (escaneado), renderiza com `pdftoppm` e passa pelo Tesseract. Imagens vão direto para o Tesseract (`por`). DOCX via mammoth.
5. **Classificação**: **uma** chamada `gpt-4o-mini` em modo JSON, com o texto truncado (75% do início e 25% do fim, onde ficam totais e vencimentos). Retorna categoria, título, tags, resumo, data de referência, valor e vencimentos.
6. **Embeddings**: **uma** chamada em lote com o "cartão" do documento (título, categoria, tags, resumo) mais todos os chunks.
7. **Persistência** em uma transação: chunks, metadados e lembretes (D-3 e D-0 às 09:00 no fuso configurado).

### Busca híbrida (`src/search/hybrid.ts`)
`score = 0.65·cosseno(embedding) + 0.35·ts_rank_cd(full-text pt sem acento) + 0.1·(categoria bate)`

- Mês e ano ("janeiro", "02/2025") viram **filtro de data**. Se o filtro zerar os resultados, a busca roda de novo sem ele.
- A categoria é só um **boost**, porque "conta de luz" pode ter sido classificada como Moradia ou como Finanças.
- "último" ou "mais recente": entre os resultados com ≥85% do melhor score, escolhe o de data mais recente.

## 3. Economia de tokens (onde e como)

| Situação                          | Custo LLM                          |
| --------------------------------- | ---------------------------------- |
| Pedir arquivo, listar, `/ultimos`, responder "2", `/lembretes` | **0 tokens** |
| Roteamento de intenção            | 0 tokens em ~90% das mensagens (regras). Ambíguas: ~80 tokens de entrada, até 3 de saída |
| Arquivo repetido                  | 0 (dedup por hash antes de OCR/LLM) |
| Imagem ilegível / sem texto       | 0 (metadados heurísticos pelo nome e legenda) |
| Salvar documento                  | 1 chamada: até ~1.000 tokens de entrada e até 350 de saída |
| Pergunta sem contexto relevante   | **0**: se a similaridade < `RAG_MIN_SIMILARITY`, responde "não encontrei" sem chamar o LLM |
| Pergunta com contexto             | Top-4 chunks de ~300 tokens, teto de 3.500 caracteres, `temperature=0`, até 300 tokens de saída |

Outros detalhes: o texto extraído é limpo (espaços e quebras redundantes), os embeddings vão em lote, e o prompt de sistema é curto e fixo.

## 4. Como executar

### Opção A: tudo local com Docker Compose
```bash
cp .env.example .env
# preencha: OPENAI_API_KEY, EVOLUTION_API_KEY, WEBHOOK_TOKEN, FILE_URL_SECRET
docker compose up -d --build

# 1) Crie a instância do WhatsApp na Evolution
curl -X POST http://localhost:8080/instance/create \
  -H "apikey: $EVOLUTION_API_KEY" -H "Content-Type: application/json" \
  -d '{"instanceName":"docs-bot","integration":"WHATSAPP-BAILEYS","qrcode":true}'

# 2) Escaneie o QR Code (também disponível no Manager: http://localhost:8080/manager)
curl http://localhost:8080/instance/connect/docs-bot -H "apikey: $EVOLUTION_API_KEY"
```
O compose já configura o **webhook global** da Evolution para `http://app:3000/webhook/evolution?token=...`. O app aplica as migrations sozinho ao subir.

### Opção B: Node local + Supabase
1. Crie um projeto no Supabase. `pgvector` e `unaccent` já vêm disponíveis.
2. Em **Storage**, crie um bucket **privado** chamado `documents`.
3. Configure o `.env`:
   ```env
   DATABASE_URL=postgresql://postgres:<senha>@db.<ref>.supabase.co:5432/postgres
   DATABASE_SSL=true
   STORAGE_DRIVER=supabase
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   ```
4. Rode:
   ```bash
   npm install
   npm run migrate
   npm run dev
   ```
5. Aponte o webhook da sua instância Evolution para `https://<seu-host>/webhook/evolution?token=<WEBHOOK_TOKEN>` com o evento `MESSAGES_UPSERT`.

> Para OCR de PDFs escaneados fora do Docker, instale o `poppler-utils` (`apt install poppler-utils` ou `brew install poppler`).

### Testes
```bash
npm test                                             # unitários
TEST_DATABASE_URL=postgres://app:app@localhost:5432/docs npm test   # + integração (rode npm run migrate antes)
```

## 5. Comandos no WhatsApp

| Mensagem                                   | O que acontece                                      |
| ------------------------------------------ | --------------------------------------------------- |
| *(envia PDF/foto/DOCX, com legenda opcional)* | Salva, classifica, resume e agenda lembretes     |
| `me manda a conta de luz de janeiro`       | Envia o arquivo original e lista alternativas       |
| `quanto paguei na última conta de luz?`    | Resposta curta via RAG, com as fontes numeradas      |
| `/ultimos` · `/ultimos 10`                 | Últimos documentos                                  |
| `/listar` · `/listar financas`             | Visão por categoria / filtro por categoria          |
| `2`                                        | Envia o item 2 da última lista ou das fontes         |
| `/lembretes`                               | Próximos vencimentos                                |
| `/buscar <termo>` · `/perguntar <texto>`   | Força a intenção                                    |

## 6. Próximos passos sugeridos
- Trocar a fila e a sessão em memória por Redis/BullMQ para rodar várias réplicas.
- Ativar RLS no Supabase se o banco for acessado por outros clientes.
- Criptografar os arquivos no bucket e aplicar políticas de retenção (LGPD).
- Adicionar `SET hnsw.iterative_scan = relaxed_order` (pgvector ≥ 0.8) para bases com muitos usuários.
- Comandos `/apagar` e `/renomear`, e busca por valor ("contas acima de R$ 500").
