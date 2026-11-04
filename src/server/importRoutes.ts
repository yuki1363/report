/** 取込・読み取り・確定の API（CLAUDE.md §4, §9-2）。 */
import type { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { applyConfirmation } from '../domain/importing.ts';
import { ConfirmBodySchema, ImportPageSchema, type Extraction, type ImportPage, type ImportRecord } from '../shared/extraction.ts';
import type { Store } from './db.ts';
import { ExtractionError, extractWithClaude, readMeggerPhoto, type MeggerReading } from './extract/claude.ts';
import { ocrImages, parseOcrText, textLayerToLines } from './extract/ocr.ts';
import { newReport } from './reportFactory.ts';

export interface Extractors {
  ai: (dataDir: string, importId: string, pages: ImportPage[]) => Promise<{ result: Extraction; model: string }>;
  /** オフライン読み取り: テキスト PDF はテキスト層、それ以外は OCR */
  ocr: (dataDir: string, importId: string, pages: ImportPage[]) => Promise<Extraction>;
  megger: (image: Buffer, mediaType: 'image/png' | 'image/jpeg') => Promise<MeggerReading>;
}

export const defaultExtractors: Extractors = {
  ai: extractWithClaude,
  ocr: async (dataDir, importId, pages) => {
    const texts: string[] = new Array(pages.length);
    const scan = pages.flatMap((p, i) => (p.kind === 'pdf-text' && p.text ? ((texts[i] = textLayerToLines(p.text)), []) : [i]));
    const ocr = await ocrImages(scan.map((i) => readFileSync(join(dataDir, 'imports', importId, pages[i]!.image))));
    scan.forEach((i, k) => (texts[i] = ocr[k]!));
    return parseOcrText(texts);
  },
  megger: readMeggerPhoto,
};

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const SOURCE_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };
const PAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg' };

const PageMetaSchema = z.array(ImportPageSchema.omit({ index: true, image: true, fileName: true }));

function asFiles(v: unknown): File[] {
  const arr = Array.isArray(v) ? v : v === undefined ? [] : [v];
  return arr.filter((x): x is File => x instanceof File);
}

export function registerImportRoutes(app: Hono, store: Store, dataDir: string, ex: Extractors): void {
  const importDir = (id: string) => join(dataDir, 'imports', id);

  /** アップロード: 元資料（source）とページ画像（page）、ページ情報（meta） */
  app.post('/api/imports', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const sources = asFiles(body['source']);
    const pageFiles = asFiles(body['page']);
    const meta = PageMetaSchema.parse(JSON.parse(String(body['meta'] ?? '[]')));
    const target = typeof body['targetReportId'] === 'string' && body['targetReportId'] ? String(body['targetReportId']) : undefined;
    if (sources.length === 0) return c.json({ error: 'ファイルがありません' }, 400);
    if (pageFiles.length === 0 || pageFiles.length !== meta.length) return c.json({ error: 'ページ情報が不正です' }, 400);
    if (target && !store.getReport(target)) return c.json({ error: '対象の報告書が見つかりません' }, 404);
    for (const f of [...sources, ...pageFiles]) {
      if (f.size > MAX_FILE_BYTES) return c.json({ error: `ファイルが大きすぎます（上限 50MB）: ${f.name}` }, 413);
    }
    for (const f of sources) if (!SOURCE_TYPES[f.type]) return c.json({ error: `対応していない形式です: ${f.name}（PDF・PNG・JPEG のみ）` }, 415);
    for (const f of pageFiles) if (!PAGE_TYPES[f.type]) return c.json({ error: 'ページ画像の形式が不正です' }, 415);

    const id = randomUUID();
    const dir = importDir(id);
    mkdirSync(dir, { recursive: true });
    const files: ImportRecord['files'] = [];
    for (const [i, f] of sources.entries()) {
      const stored = `src-${i}.${SOURCE_TYPES[f.type]}`;
      writeFileSync(join(dir, stored), Buffer.from(await f.arrayBuffer()));
      files.push({ name: f.name, stored, type: f.type });
    }
    const pages: ImportPage[] = [];
    for (const [i, f] of pageFiles.entries()) {
      const m = meta[i]!;
      if (m.fileIndex < 0 || m.fileIndex >= files.length) return c.json({ error: 'ページ情報が不正です' }, 400);
      const image = `page-${i}.${PAGE_TYPES[f.type]}`;
      writeFileSync(join(dir, image), Buffer.from(await f.arrayBuffer()));
      pages.push({ ...m, index: i, image, fileName: files[m.fileIndex]!.name });
    }
    const rec = store.saveImport({
      id,
      createdAt: new Date().toISOString(),
      ...(target ? { targetReportId: target } : {}),
      files,
      pages,
      status: 'uploaded',
    });
    return c.json(rec, 201);
  });

  app.get('/api/imports/:id', (c) => {
    const rec = store.getImport(c.req.param('id'));
    return rec ? c.json(rec) : c.json({ error: 'not found' }, 404);
  });

  app.get('/api/imports/:id/pages/:n', (c) => {
    const rec = store.getImport(c.req.param('id'));
    const page = rec?.pages[Number(c.req.param('n'))];
    if (!rec || !page) return c.json({ error: 'not found' }, 404);
    const buf = readFileSync(join(importDir(rec.id), page.image));
    return c.body(new Uint8Array(buf), 200, {
      'Content-Type': page.image.endsWith('.png') ? 'image/png' : 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    });
  });

  app.get('/api/imports/:id/files/:n', (c) => {
    const rec = store.getImport(c.req.param('id'));
    const f = rec?.files[Number(c.req.param('n'))];
    if (!rec || !f) return c.json({ error: 'not found' }, 404);
    return c.body(new Uint8Array(readFileSync(join(importDir(rec.id), f.stored))), 200, { 'Content-Type': f.type });
  });

  /** 読み取り実行。外部 AI 読み取りが OFF のときは OCR（Tesseract）を使う。 */
  app.post('/api/imports/:id/extract', async (c) => {
    const rec = store.getImport(c.req.param('id'));
    if (!rec) return c.json({ error: 'not found' }, 404);
    if (rec.status === 'confirmed') return c.json({ error: 'この取込は確定済みです' }, 409);
    const engine = store.getSettings().aiExtraction ? 'ai' : 'ocr';
    store.saveImport({ ...rec, status: 'extracting', engine });
    try {
      let result: Extraction;
      let model: string | undefined;
      if (engine === 'ai') {
        ({ result, model } = await ex.ai(dataDir, rec.id, rec.pages));
      } else {
        result = await ex.ocr(dataDir, rec.id, rec.pages);
      }
      const { error: _e, ...rest } = rec;
      return c.json(store.saveImport({ ...rest, status: 'extracted', engine, ...(model ? { model } : {}), result }));
    } catch (e) {
      const message = e instanceof ExtractionError ? e.message : `読み取りに失敗しました: ${(e as Error).message}`;
      store.saveImport({ ...rec, status: 'failed', engine, error: message });
      return c.json({ error: message }, 502);
    }
  });

  /** 利用者の確認を経た内容で報告書を作成・更新する。 */
  app.post('/api/imports/:id/confirm', async (c) => {
    const rec = store.getImport(c.req.param('id'));
    if (!rec) return c.json({ error: 'not found' }, 404);
    if (rec.status === 'confirmed') return c.json({ error: 'この取込は確定済みです' }, 409);
    const body = ConfirmBodySchema.parse(await c.req.json());
    let base;
    if (body.mode === 'new') {
      base = newReport();
    } else {
      base = body.targetReportId ? store.getReport(body.targetReportId) : undefined;
      if (!base) return c.json({ error: '対象の報告書が見つかりません' }, 404);
    }
    const source = rec.engine === 'ocr' ? 'ocr' : rec.engine === 'ai' ? 'ai' : 'manual';
    const files = rec.files.map((f) => `imports/${rec.id}/${f.stored}`);
    const report = store.saveReport(applyConfirmation(base, body, source, files, randomUUID));
    store.saveImport({ ...rec, status: 'confirmed', confirmedReportId: report.id });
    return c.json(report);
  });

  /** P4（実験的）: メガー表示写真の読み取り。外部 AI 読み取りが ON のときだけ使える。 */
  app.post('/api/megger', async (c) => {
    if (!store.getSettings().aiExtraction) {
      return c.json({ error: '外部 AI 読み取りが OFF です（設定画面で ON にすると使えます）' }, 409);
    }
    const body = await c.req.parseBody();
    const f = body['image'];
    if (!(f instanceof File) || !PAGE_TYPES[f.type]) return c.json({ error: 'PNG または JPEG の画像を指定してください' }, 400);
    if (f.size > 10 * 1024 * 1024) return c.json({ error: '画像が大きすぎます（上限 10MB）' }, 413);
    try {
      return c.json(await ex.megger(Buffer.from(await f.arrayBuffer()), f.type as 'image/png' | 'image/jpeg'));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });
}
