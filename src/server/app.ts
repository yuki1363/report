/** HTTP API（Hono）。localhost 専用。 */
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { comparePrevious } from '../domain/compare.ts';
import { generateSheet } from '../domain/generate.ts';
import { renderSheetHtml } from '../domain/renderHtml.ts';
import {
  DEFAULT_CRITERIA,
  ReportSchema,
  SettingsSchema,
  SheetSchema,
  type Report,
  type Sheet,
  type Template,
} from '../shared/schema.ts';
import type { Store } from './db.ts';
import { sheetsToXlsx, sheetToXlsx } from '../domain/excel.ts';
import { defaultExtractors, registerImportRoutes, type Extractors } from './importRoutes.ts';
import { mergePdfs } from './mergePdf.ts';
import { htmlToPdf, PdfBrowserError } from './pdf.ts';
import { claudeModel } from './extract/claude.ts';
import { deriveReport, newReport, todayLocal } from './reportFactory.ts';
import { builtinTemplates } from './templates.ts';

export { deriveReport, newReport, todayLocal } from './reportFactory.ts';

export interface AppDeps {
  store: Store;
  /** 取込ファイルの保存先（data/） */
  dataDir: string;
  /** 保存先の情報（設定画面に表示する） */
  paths?: { home: string; dataDir: string; portable: boolean };
  /** テスト用に差し替え可能 */
  pdf?: (html: string) => Promise<Buffer>;
  extractors?: Partial<Extractors>;
}

const CreateBodySchema = z.object({ from: z.string().optional(), mode: z.enum(['copy', 'inherit']).optional() });
const TemplateBodySchema = z.object({ name: z.string().trim().min(1).max(100), sheet: SheetSchema });
const PrintBodySchema = z.object({ ids: z.array(z.string()).min(1).max(200) });
const RenderBodySchema = z.object({ sheet: SheetSchema, report: ReportSchema });

/** 変更系リクエストで、他サイトからの送信（CSRF）を防ぐための独自ヘッダ（multipart 用） */
export const APP_HEADER = 'x-report-app';

function attachmentName(report: Report, ext: string): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, '_').trim();
  return `絶縁抵抗測定報告書_${safe(report.panel.name) || '無題'}_${report.date}.${ext}`;
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function createApp({ store, dataDir, paths, pdf = htmlToPdf, extractors = {} }: AppDeps): Hono {
  const app = new Hono();

  // ローカル専用の防御: Host ヘッダ検査（DNS リバインディング対策）と、
  // 変更系リクエストは JSON か独自ヘッダ付き multipart に限定（他サイトからのフォーム送信=CSRF を防ぐ）
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const host = (c.req.header('host') ?? '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return c.json({ error: 'forbidden host' }, 403);
    if (['POST', 'PUT', 'DELETE'].includes(c.req.method)) {
      const origin = c.req.header('origin');
      if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
        return c.json({ error: 'forbidden origin' }, 403);
      }
      const ct = c.req.header('content-type') ?? '';
      const okJson = ct.startsWith('application/json');
      const okMultipart = ct.startsWith('multipart/form-data') && c.req.header(APP_HEADER) === '1';
      if (c.req.method !== 'DELETE' && !okJson && !okMultipart) {
        return c.json({ error: 'Content-Type は application/json にしてください' }, 415);
      }
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof z.ZodError) return c.json({ error: '入力値が不正です', issues: err.issues }, 400);
    if (err instanceof SyntaxError) return c.json({ error: 'JSON の形式が不正です' }, 400);
    if (err instanceof PdfBrowserError) return c.json({ error: err.message }, 500);
    console.error(err);
    return c.json({ error: err.message }, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true, build: process.env.APP_BUILD ?? 'dev' }));

  // --- テンプレート ---
  const allTemplates = (): (Template & { builtin: boolean })[] => [
    ...builtinTemplates().map((t) => ({ ...t, builtin: true })),
    ...store.listUserTemplates().map((t) => ({ ...t, builtin: false })),
  ];
  const findTemplate = (id: string) => allTemplates().find((t) => t.id === id);

  app.get('/api/templates', (c) => c.json(allTemplates().map((t) => ({ id: t.id, name: t.name, builtin: t.builtin }))));
  app.get('/api/templates/:id', (c) => {
    const t = findTemplate(c.req.param('id'));
    return t ? c.json(t) : c.json({ error: 'not found' }, 404);
  });
  app.post('/api/templates', async (c) => {
    const body = TemplateBodySchema.parse(await c.req.json());
    return c.json(store.saveUserTemplate({ id: `u-${randomUUID()}`, name: body.name, sheet: body.sheet }), 201);
  });
  app.put('/api/templates/:id', async (c) => {
    const id = c.req.param('id');
    if (!store.getUserTemplate(id)) return c.json({ error: '既定テンプレートは上書きできません（名前を付けて保存してください）' }, 404);
    const body = TemplateBodySchema.parse(await c.req.json());
    return c.json(store.saveUserTemplate({ id, name: body.name, sheet: body.sheet }));
  });
  app.delete('/api/templates/:id', (c) => {
    const id = c.req.param('id');
    const inUse = store.allReports().filter((r) => r.templateId === id).length;
    if (!store.deleteUserTemplate(id)) return c.json({ error: '既定テンプレートは削除できません' }, 404);
    return c.json({ deleted: true, reportsUsingIt: inUse });
  });

  // --- 報告書 ---
  app.get('/api/reports', (c) => c.json(store.listReports()));

  app.post('/api/reports', async (c) => {
    const body = CreateBodySchema.parse(await c.req.json().catch(() => ({})));
    let report: Report;
    if (body.from) {
      const src = store.getReport(body.from);
      if (!src) return c.json({ error: '元の報告書が見つかりません' }, 404);
      report = deriveReport(src, body.mode ?? 'copy');
    } else {
      report = newReport();
    }
    return c.json(store.saveReport(report), 201);
  });

  app.get('/api/reports/:id', (c) => {
    const r = store.getReport(c.req.param('id'));
    return r ? c.json(r) : c.json({ error: 'not found' }, 404);
  });

  app.put('/api/reports/:id', async (c) => {
    const report = ReportSchema.parse(await c.req.json());
    if (report.id !== c.req.param('id')) return c.json({ error: 'id が一致しません' }, 400);
    return c.json(store.saveReport(report));
  });

  app.delete('/api/reports/:id', (c) =>
    store.deleteReport(c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'not found' }, 404),
  );

  /** 報告書に使う書式（この報告書だけの書式 → 選択したテンプレート → 既定 の順） */
  const sheetFor = (report: Report): Sheet =>
    report.sheetOverride ?? findTemplate(report.templateId)?.sheet ?? findTemplate('default')!.sheet;
  const settings = () => store.getSettings();
  const renderReport = (report: Report, sheet = sheetFor(report)): string =>
    renderSheetHtml(generateSheet(sheet, report, DEFAULT_CRITERIA), { title: `絶縁抵抗測定報告書 ${report.panel.name}` });

  app.get('/api/reports/:id/html', (c) => {
    const r = store.getReport(c.req.param('id'));
    if (!r) return c.json({ error: 'not found' }, 404);
    return c.html(renderReport(r));
  });

  /** 書式エディタのプレビュー（保存前の書式で描画） */
  app.post('/api/render-html', async (c) => {
    const { sheet, report } = RenderBodySchema.parse(await c.req.json());
    return c.html(renderReport(report, sheet));
  });

  app.get('/api/reports/:id/pdf', async (c) => {
    const r = store.getReport(c.req.param('id'));
    if (!r) return c.json({ error: 'not found' }, 404);
    const buf = await pdf(renderReport(r));
    return c.body(new Uint8Array(buf), 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': contentDisposition(attachmentName(r, 'pdf')),
    });
  });

  /**
   * 一括印刷・選択印刷: 指定した報告書（順番どおり）を、1つの PDF にまとめて返す。
   * 報告書ごとに書式（A4縦など）が違っても、それぞれの用紙設定のまま並べる。
   */
  app.post('/api/print', async (c) => {
    const { ids } = PrintBodySchema.parse(await c.req.json());
    const reports: Report[] = [];
    for (const id of ids) {
      const r = store.getReport(id);
      if (!r) return c.json({ error: `報告書が見つかりません（削除された可能性があります）: ${id}` }, 404);
      reports.push(r);
    }
    const parts: Uint8Array[] = [];
    for (const r of reports) parts.push(await pdf(renderReport(r)));
    const merged = parts.length === 1 ? parts[0]! : await mergePdfs(parts);
    const day = todayLocal();
    return c.body(new Uint8Array(merged), 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': contentDisposition(`絶縁抵抗測定報告書_${reports.length}件_${day}.pdf`),
    });
  });

  /**
   * 一括・選択の Excel 出力: 指定した報告書（順番どおり）を、1つの Excel ファイルにまとめる（報告書1件につき1シート）。
   * 用紙・余白・印刷範囲・見出し行は、シートごとの書式のまま。
   */
  app.post('/api/print-xlsx', async (c) => {
    const { ids } = PrintBodySchema.parse(await c.req.json());
    const reports: Report[] = [];
    for (const id of ids) {
      const r = store.getReport(id);
      if (!r) return c.json({ error: `報告書が見つかりません（削除された可能性があります）: ${id}` }, 404);
      reports.push(r);
    }
    const buf = await sheetsToXlsx(
      reports.map((r) => ({ sheet: generateSheet(sheetFor(r), r, DEFAULT_CRITERIA), title: r.panel.name })),
      { colWidthMmPerChar: settings().colWidthMmPerChar },
    );
    return c.body(new Uint8Array(buf), 200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': contentDisposition(`絶縁抵抗測定報告書_${reports.length}件_${todayLocal()}.xlsx`),
    });
  });

  app.get('/api/reports/:id/xlsx', async (c) => {
    const r = store.getReport(c.req.param('id'));
    if (!r) return c.json({ error: 'not found' }, 404);
    const buf = await sheetToXlsx(generateSheet(sheetFor(r), r, DEFAULT_CRITERIA), {
      colWidthMmPerChar: settings().colWidthMmPerChar,
      title: `${r.panel.name || '報告書'}`.slice(0, 31),
    });
    return c.body(new Uint8Array(buf), 200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': contentDisposition(attachmentName(r, 'xlsx')),
    });
  });

  /** P4: 前回値との比較 */
  app.get('/api/reports/:id/previous', (c) => {
    const r = store.getReport(c.req.param('id'));
    if (!r) return c.json({ error: 'not found' }, 404);
    return c.json(comparePrevious(r, store.allReports()));
  });

  // --- 取込・読み取り ---
  registerImportRoutes(app, store, dataDir, { ...defaultExtractors, ...extractors });

  // --- 設定 ---
  app.get('/api/settings', (c) =>
    c.json({
      settings: settings(),
      criteria: DEFAULT_CRITERIA,
      model: claudeModel(),
      apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      paths: paths ?? { home: '', dataDir, portable: false },
    }),
  );
  app.put('/api/settings', async (c) => c.json(store.saveSettings(SettingsSchema.parse(await c.req.json()))));

  /** 取り込み: バックアップの .db、または旧版の data/app.db から報告書・テンプレートを取り込む（既存は消さない） */
  app.post('/api/restore', async (c) => {
    const body = await c.req.parseBody();
    const f = body['file'];
    if (!(f instanceof File)) return c.json({ error: 'ファイルを指定してください' }, 400);
    if (f.size > 500 * 1024 * 1024) return c.json({ error: 'ファイルが大きすぎます（上限 500MB）' }, 413);
    const dir = mkdtempSync(join(tmpdir(), 'report-restore-'));
    const file = join(dir, 'import.db');
    try {
      writeFileSync(file, Buffer.from(await f.arrayBuffer()));
      return c.json(store.importFrom(file));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** バックアップ: データベース（報告書・テンプレート・設定・取込の記録）を1ファイルでダウンロード */
  app.get('/api/backup', async (c) => {
    const dir = mkdtempSync(join(tmpdir(), 'report-backup-'));
    const file = join(dir, 'app.db');
    try {
      await store.backupTo(file);
      const buf = readFileSync(file);
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      return c.body(new Uint8Array(buf), 200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': contentDisposition(`report-backup-${stamp}.db`),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  return app;
}
