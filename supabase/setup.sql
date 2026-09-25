-- =============================================================================
-- supabase/setup.sql — cole TUDO no Supabase: SQL Editor → New query → Run.
-- Cria as tabelas (mesmo conteúdo de db/migrations/001_init.sql), o bucket
-- privado "documents" e registra a migration (assim `npm run migrate` não repete).
-- Pode ser executado mais de uma vez sem problema.
-- =============================================================================

create extension if not exists vector;
create extension if not exists unaccent;

-- Configuração de full-text search em português que ignora acentos
-- ("conta de água" casa com "agua"). Usada na busca híbrida.
do $$
begin
  if not exists (select 1 from pg_ts_config where cfgname = 'pt_unaccent') then
    create text search configuration pt_unaccent (copy = portuguese);
    alter text search configuration pt_unaccent
      alter mapping for hword, hword_part, word with unaccent, portuguese_stem;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- documents: 1 linha por arquivo enviado. Guarda metadados + embedding do
-- "cartão" do documento (título + resumo + tags), usado na busca por ARQUIVO.
-- -----------------------------------------------------------------------------
create table if not exists documents (
  id             uuid primary key default gen_random_uuid(),
  user_phone     text        not null,
  file_name      text        not null,                 -- nome original (ou gerado p/ imagens)
  titulo         text,                                  -- nome curto e legível sugerido pelo LLM
  file_url       text        not null,                  -- chave do objeto no bucket (privado);
                                                        -- a URL assinada é gerada sob demanda
  mime_type      text        not null,
  file_size      integer,
  content_hash   text        not null,                  -- sha256: evita reprocessar duplicatas
  categoria      text        not null default 'Outros',
  tags_sugeridas text[]      not null default '{}',
  resumo_curto   text,
  doc_date       date,                                  -- data de referência/competência
  valor_total    numeric(14, 2),
  status         text        not null default 'processing'
                 check (status in ('processing', 'ready', 'failed')),
  error          text,
  search_text    text        not null default '',       -- texto p/ full-text (montado na app)
  search_tsv     tsvector generated always as (to_tsvector('pt_unaccent', search_text)) stored,
  embedding      vector(1536),                           -- text-embedding-3-small
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_phone, content_hash)
);

create index if not exists documents_user_created_idx on documents (user_phone, created_at desc);
create index if not exists documents_user_categoria_idx on documents (user_phone, categoria);
create index if not exists documents_tsv_idx on documents using gin (search_tsv);
create index if not exists documents_tags_idx on documents using gin (tags_sugeridas);
create index if not exists documents_embedding_idx
  on documents using hnsw (embedding vector_cosine_ops);

-- -----------------------------------------------------------------------------
-- chunks: pedaços do texto extraído + embedding. Usados na busca por CONTEÚDO (RAG).
-- user_phone é desnormalizado para filtrar sem JOIN antes do ANN.
-- -----------------------------------------------------------------------------
create table if not exists chunks (
  id           bigserial primary key,
  document_id  uuid    not null references documents (id) on delete cascade,
  user_phone   text    not null,
  chunk_index  integer not null,
  content      text    not null,
  token_count  integer not null,
  embedding    vector(1536) not null,
  created_at   timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists chunks_user_idx on chunks (user_phone);
-- Dica (pgvector >= 0.8): em bases multiusuário, use
--   SET hnsw.iterative_scan = relaxed_order;
-- para que o filtro por user_phone não reduza o número de resultados do ANN.
create index if not exists chunks_embedding_idx
  on chunks using hnsw (embedding vector_cosine_ops);

-- -----------------------------------------------------------------------------
-- reminders: alertas de vencimento detectados automaticamente.
-- -----------------------------------------------------------------------------
create table if not exists reminders (
  id           bigserial primary key,
  user_phone   text        not null,
  document_id  uuid        references documents (id) on delete cascade,
  title        text        not null,
  due_date     date        not null,
  remind_at    timestamptz not null,
  status       text        not null default 'pending'
               check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts     integer     not null default 0,
  last_error   text,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (document_id, due_date, remind_at)
);

create index if not exists reminders_due_idx on reminders (status, remind_at);
create index if not exists reminders_user_idx on reminders (user_phone, due_date);

-- Mantém updated_at atualizado.
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists documents_set_updated_at on documents;
create trigger documents_set_updated_at
  before update on documents
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- Bucket privado para os arquivos originais.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Registro da migration (compatível com src/scripts/migrate.ts).
-- -----------------------------------------------------------------------------
create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now());
insert into schema_migrations (name) values ('001_init.sql') on conflict do nothing;
