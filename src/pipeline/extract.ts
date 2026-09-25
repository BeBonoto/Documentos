/**
 * Extração de texto por tipo de arquivo.
 *   PDF com camada de texto -> unpdf (rápido, sem OCR)
 *   PDF escaneado           -> pdftoppm (poppler) + Tesseract
 *   Imagem                  -> Tesseract (OCR leve, local, sem custo de API)
 *   DOCX                    -> mammoth
 *   TXT                     -> direto
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import mammoth from 'mammoth';
import { createWorker, type Worker } from 'tesseract.js';
import { extractText as extractPdfText } from 'unpdf';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { cleanExtractedText } from '../utils/text.js';

const execFileAsync = promisify(execFile);

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function isSupportedMime(mime: string): boolean {
  return mime === 'application/pdf' || mime.startsWith('image/') || mime === DOCX_MIME || mime === 'text/plain';
}

// Um único worker do Tesseract reaproveitado (carregar o modelo é a parte cara).
let ocrWorker: Promise<Worker> | null = null;
function getOcrWorker(): Promise<Worker> {
  ocrWorker ??= createWorker(env.OCR_LANG);
  return ocrWorker;
}

async function ocrImage(data: Buffer): Promise<string> {
  const worker = await getOcrWorker();
  const { data: result } = await worker.recognize(data);
  return result.text;
}

/** Renderiza as primeiras páginas do PDF em PNG e roda OCR (requer poppler-utils). */
async function ocrPdf(data: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ocr-'));
  try {
    const input = path.join(dir, 'in.pdf');
    await writeFile(input, data);
    await execFileAsync('pdftoppm', ['-r', '150', '-png', '-l', String(env.OCR_MAX_PDF_PAGES), input, path.join(dir, 'page')]);
    const pages = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort();
    const texts: string[] = [];
    for (const page of pages) texts.push(await ocrImage(await readFile(path.join(dir, page))));
    return texts.join('\n\n');
  } catch (err) {
    logger.warn({ err }, 'OCR de PDF indisponível (pdftoppm instalado?)');
    return '';
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function extractText(data: Buffer, mime: string): Promise<string> {
  let text = '';
  if (mime === 'application/pdf') {
    const { text: pdfText, totalPages } = await extractPdfText(new Uint8Array(data), { mergePages: true });
    text = pdfText;
    // Pouco texto por página => provavelmente escaneado: cai para OCR.
    if (text.replace(/\s/g, '').length < 40 * Math.min(totalPages, 3)) {
      const ocr = await ocrPdf(data);
      if (ocr.trim().length > text.trim().length) text = ocr;
    }
  } else if (mime.startsWith('image/')) {
    text = await ocrImage(data);
  } else if (mime === DOCX_MIME) {
    text = (await mammoth.extractRawText({ buffer: data })).value;
  } else if (mime === 'text/plain') {
    text = data.toString('utf8');
  }
  return cleanExtractedText(text);
}
