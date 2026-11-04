/** HTTP API（Hono）。localhost 専用。 */
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { generateSheet } from '../domain/generate.ts';
import { renderSheetHtml } from '../domain/renderHtml.ts';
import { DEFAULT_CRITERIA, ReportSchema, SettingsSchema, type Report } from '../shared/schema.ts';
import type { Store } from './db.ts';
import { htmlToPdf, PdfBrowserError } from './pdf.ts';
import { builtinTemplates, getTemplate } from './templates.ts';

export interface AppDeps {
  store: Store;
  /** テスト用に差し替え可能 */
  pdf?: (html: string) => Promise<Buffer>;
}

export function todayLocal(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function newReport(): Report {
  return {
    id: randomUUID(),
    templateId: 'default',
    panel: { name: '' },
    date: todayLocal(),
    inspector: '',
    instrument: { model: '' },
    circuits: [],
    sourceFiles: [],
  };
}

/**
 * 既存の報告書から新規作成する。
 * - copy:    すべて複製（測定値も含む）。測定日は今日にする。
 * - inherit: 前回値の引き継ぎ。盤・回路構成・測定器・測定者を引き継ぎ、測定値・温湿度は空にする。
 */
export function deriveReport(src: Report, mode: 'copy' | 'inherit'): Report {
  const base = structuredClone(src);
  base.id = randomUUID();
  base.date = todayLocal();
  base.circuits = base.circuits.map((c) => ({ ...c, id: randomUUID(), readings: mode === 'copy' ? c.readings : {} }));
  if (mode === 'inherit') {
    delete base.tempC;
    delete base.humidity;
  }
  return base;
}

const CreateBodySchema = z.object({ from: z.string().optional(), mode: z.enum(['copy', 'inherit']).optional() });

function attachmentName(report: Report, ext: string): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, '_').trim();
  return `絶縁抵抗測定報告書_${safe(report.panel.name) || '無題'}_${report.date}.${ext}`;
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function createApp({ store, pdf = htmlToPdf }: AppDeps): Hono {
  const app = new Hono();

  // ローカル専用の防御: Host ヘッダ検査（DNS リバインディング対策）と、
  // 変更系リクエストは JSON 限定（他サイトからのフォーム送信=CSRF を防ぐ）
  app.use('/api/*', async (c, next) => {
    const host = (c.req.header('host') ?? '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return c.json({ error: 'forbidden host' }, 403);
    if (['POST', 'PUT', 'DELETE'].includes(c.req.method)) {
      const ct = c.req.header('content-type') ?? '';
      if (c.req.method !== 'DELETE' && !ct.startsWith('application/json')) {
        return c.json({ error: 'Content-Type は application/json にしてください' }, 415);
      }
      const origin = c.req.header('origin');
      if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
        return c.json({ error: 'forbidden origin' }, 403);
      }
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof z.ZodError) return c.json({ error: '入力値が不正です', issues: err.issues }, 400);
    if (err instanceof PdfBrowserError) return c.json({ error: err.message }, 500);
    console.error(err);
    return c.json({ error: err.message }, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

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

  const renderReport = (report: Report): string => {
    const template = getTemplate(report.templateId) ?? getTemplate('default')!;
    const sheet = generateSheet(report.sheetOverride ?? template.sheet, report, DEFAULT_CRITERIA);
    return renderSheetHtml(sheet, { title: `絶縁抵抗測定報告書 ${report.panel.name}` });
  };

  app.get('/api/reports/:id/html', (c) => {
    const r = store.getReport(c.req.param('id'));
    if (!r) return c.json({ error: 'not found' }, 404);
    return c.html(renderReport(r));
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

  // --- テンプレート ---
  app.get('/api/templates', (c) => c.json(builtinTemplates().map((t) => ({ id: t.id, name: t.name }))));
  app.get('/api/templates/:id', (c) => {
    const t = getTemplate(c.req.param('id'));
    return t ? c.json(t) : c.json({ error: 'not found' }, 404);
  });

  // --- 設定 ---
  app.get('/api/settings', (c) =>
    c.json({
      settings: store.getSettings(),
      criteria: DEFAULT_CRITERIA,
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
      apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    }),
  );
  app.put('/api/settings', async (c) => c.json(store.saveSettings(SettingsSchema.parse(await c.req.json()))));

  return app;
}
