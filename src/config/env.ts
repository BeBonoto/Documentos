/**
 * Configuração centralizada e validada (falha rápido no boot se algo faltar).
 */
import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.string().default('info'),
    PORT: z.coerce.number().default(3000),
    /** URL pela qual a Evolution API consegue alcançar este serviço (usada no driver local). */
    PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),

    /** Token exigido em /webhook/evolution?token=... */
    WEBHOOK_TOKEN: z.string().min(16, 'WEBHOOK_TOKEN precisa de ao menos 16 caracteres'),
    /** Lista de telefones autorizados (vazio = qualquer um). Ex.: 5511999999999,5521988887777 */
    ALLOWED_PHONES: z
      .string()
      .default('')
      .transform((v) => v.split(',').map((p) => p.replace(/\D/g, '')).filter(Boolean)),
    QUEUE_CONCURRENCY: z.coerce.number().default(3),

    DATABASE_URL: z.string().min(1),
    DATABASE_SSL: bool,

    EVOLUTION_API_URL: z.string().min(1),
    EVOLUTION_API_KEY: z.string().min(1),
    EVOLUTION_INSTANCE: z.string().min(1),

    OPENAI_API_KEY: z.string().min(1),
    EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    CHAT_MODEL: z.string().default('gpt-4o-mini'),

    STORAGE_DRIVER: z.enum(['local', 'supabase']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('./data/uploads'),
    FILE_URL_SECRET: z.string().default(''),
    SUPABASE_URL: z.string().default(''),
    SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
    SUPABASE_BUCKET: z.string().default('documents'),
    SIGNED_URL_TTL_SECONDS: z.coerce.number().default(600),

    OCR_LANG: z.string().default('por'),
    OCR_MAX_PDF_PAGES: z.coerce.number().default(5),
    MAX_FILE_MB: z.coerce.number().default(15),

    // ---- Parâmetros de economia de tokens ----
    CLASSIFY_MAX_CHARS: z.coerce.number().default(4000),
    CHUNK_SIZE: z.coerce.number().default(1200),
    CHUNK_OVERLAP: z.coerce.number().default(150),
    RAG_TOP_K: z.coerce.number().default(4),
    RAG_MIN_SIMILARITY: z.coerce.number().default(0.25),
    RAG_MAX_CONTEXT_CHARS: z.coerce.number().default(3500),
    RAG_MAX_OUTPUT_TOKENS: z.coerce.number().default(300),
    LLM_INTENT_FALLBACK: bool,

    REMINDER_DAYS_BEFORE: z.coerce.number().default(3),
    REMINDER_HOUR: z.coerce.number().min(0).max(23).default(9),
    REMINDER_TZ: z.string().default('America/Sao_Paulo'),
    REMINDER_POLL_SECONDS: z.coerce.number().default(60),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.STORAGE_DRIVER === 'supabase' && (!cfg.SUPABASE_URL || !cfg.SUPABASE_SERVICE_ROLE_KEY)) {
      ctx.addIssue({ code: 'custom', message: 'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios com STORAGE_DRIVER=supabase' });
    }
    if (cfg.STORAGE_DRIVER === 'local' && cfg.FILE_URL_SECRET.length < 16) {
      ctx.addIssue({ code: 'custom', message: 'FILE_URL_SECRET (>=16 chars) é obrigatório com STORAGE_DRIVER=local' });
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.') || '(geral)'}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
