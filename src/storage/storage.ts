/**
 * Abstração de armazenamento de arquivos.
 *  - `supabase`: Supabase Storage (bucket privado + URL assinada).
 *  - `local`:    disco local + URL assinada via HMAC servida por este app (bom p/ dev).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

export interface Storage {
  upload(key: string, data: Buffer, contentType: string): Promise<void>;
  /** URL temporária que a Evolution API usa para baixar e enviar o arquivo. */
  signedUrl(key: string, ttlSeconds?: number): Promise<string>;
}

// ------------------------------- Supabase -----------------------------------
function supabaseStorage(): Storage {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const bucket = client.storage.from(env.SUPABASE_BUCKET);
  return {
    async upload(key, data, contentType) {
      const { error } = await bucket.upload(key, data, { contentType, upsert: false });
      if (error) throw new Error(`Supabase upload falhou: ${error.message}`);
    },
    async signedUrl(key, ttl = env.SIGNED_URL_TTL_SECONDS) {
      const { data, error } = await bucket.createSignedUrl(key, ttl);
      if (error || !data) throw new Error(`Supabase signed URL falhou: ${error?.message}`);
      return data.signedUrl;
    },
  };
}

// --------------------------------- Local ------------------------------------
const localRoot = path.resolve(env.LOCAL_STORAGE_DIR);

function sign(key: string, exp: number): string {
  return createHmac('sha256', env.FILE_URL_SECRET).update(`${key}:${exp}`).digest('base64url');
}

/** Resolve a chave para um caminho dentro do diretório raiz (bloqueia path traversal). */
export function resolveLocalPath(key: string): string {
  const full = path.resolve(localRoot, key);
  if (!full.startsWith(localRoot + path.sep)) throw new Error('Chave de arquivo inválida');
  return full;
}

/** Valida a assinatura de uma URL gerada pelo driver local. */
export function verifyLocalSignature(key: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(sign(key, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function readLocalFile(key: string): Promise<Buffer> {
  return readFile(resolveLocalPath(key));
}

function localStorage(): Storage {
  return {
    async upload(key, data) {
      const full = resolveLocalPath(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, data, { flag: 'wx' });
    },
    async signedUrl(key, ttl = env.SIGNED_URL_TTL_SECONDS) {
      const exp = Math.floor(Date.now() / 1000) + ttl;
      const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
      return `${base}/files/${key.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&sig=${sign(key, exp)}`;
    },
  };
}

export const storage: Storage = env.STORAGE_DRIVER === 'supabase' ? supabaseStorage() : localStorage();
