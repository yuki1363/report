import type { Layout } from '../domain/layout.ts';
import type { ConfirmBody, ImportRecord } from '../shared/extraction.ts';
import type { Criteria, Report, ReportSummary, Settings, Sheet, Template } from '../shared/schema.ts';

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  return parse<T>(
    await fetch(path, {
      ...init,
      headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
    }),
  );
}

/** multipart 送信（CSRF 対策の独自ヘッダを付ける） */
async function upload<T>(path: string, fd: FormData): Promise<T> {
  return parse<T>(await fetch(path, { method: 'POST', body: fd, headers: { 'x-report-app': '1' } }));
}

/** ファイルをダウンロードさせる（ファイル名は Content-Disposition から取る） */
async function download(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `ダウンロードに失敗しました (${res.status})`);
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
  const name = m ? decodeURIComponent(m[1]!) : fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface SettingsResponse {
  settings: Settings;
  criteria: Criteria;
  model: string;
  apiKeyConfigured: boolean;
  paths: { home: string; dataDir: string; portable: boolean };
}

export interface TemplateSummary {
  id: string;
  name: string;
  builtin: boolean;
}

export const api = {
  listReports: () => call<ReportSummary[]>('/api/reports'),
  getLayout: () => call<Layout>('/api/layout'),
  saveLayout: (layout: Layout) => call<Layout>('/api/layout', { method: 'PUT', body: JSON.stringify(layout) }),
  createReport: (from?: string, mode?: 'copy' | 'inherit') =>
    call<Report>('/api/reports', { method: 'POST', body: JSON.stringify(from ? { from, mode } : {}) }),
  getReport: (id: string) => call<Report>(`/api/reports/${id}`),
  saveReport: (r: Report) => call<Report>(`/api/reports/${r.id}`, { method: 'PUT', body: JSON.stringify(r) }),
  deleteReport: (id: string) => call<void>(`/api/reports/${id}`, { method: 'DELETE' }),

  listTemplates: () => call<TemplateSummary[]>('/api/templates'),
  getTemplate: (id: string) => call<Template & { builtin: boolean }>(`/api/templates/${id}`),
  createTemplate: (name: string, sheet: Sheet) => call<Template>('/api/templates', { method: 'POST', body: JSON.stringify({ name, sheet }) }),
  updateTemplate: (id: string, name: string, sheet: Sheet) =>
    call<Template>(`/api/templates/${id}`, { method: 'PUT', body: JSON.stringify({ name, sheet }) }),
  deleteTemplate: (id: string) => call<{ deleted: boolean; reportsUsingIt: number }>(`/api/templates/${id}`, { method: 'DELETE' }),
  async renderHtml(sheet: Sheet, report: Report): Promise<string> {
    const res = await fetch('/api/render-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet, report }),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'プレビューに失敗しました');
    return res.text();
  },

  uploadImport: (fd: FormData) => upload<ImportRecord>('/api/imports', fd),
  getImport: (id: string) => call<ImportRecord>(`/api/imports/${id}`),
  extract: (id: string) => call<ImportRecord>(`/api/imports/${id}/extract`, { method: 'POST', body: '{}' }),
  confirmImport: (id: string, body: ConfirmBody) =>
    call<{ reports: Report[] }>(`/api/imports/${id}/confirm`, { method: 'POST', body: JSON.stringify(body) }),

  getSettings: () => call<SettingsResponse>('/api/settings'),
  saveSettings: (s: Settings) => call<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),

  /** 複数の報告書を1つの PDF（または Excel。報告書1件が1シート）にまとめる（一括・選択）。ids の順番どおりに並ぶ */
  async printReports(ids: string[], format: 'pdf' | 'xlsx' = 'pdf'): Promise<{ blob: Blob; name: string }> {
    const res = await fetch(format === 'xlsx' ? '/api/print-xlsx' : '/api/print', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `${format === 'xlsx' ? 'Excel' : 'PDF'} の作成に失敗しました (${res.status})`);
    }
    const m = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') ?? '');
    return { blob: await res.blob(), name: m ? decodeURIComponent(m[1]!) : `reports.${format}` };
  },
  downloadPdf: (id: string) => download(`/api/reports/${id}/pdf`, 'report.pdf'),
  downloadXlsx: (id: string) => download(`/api/reports/${id}/xlsx`, 'report.xlsx'),
  restore: (fd: FormData) => upload<{ reports: number; templates: number; skippedOlder: number; invalid: number }>('/api/restore', fd),
  downloadBackup: () => download('/api/backup', 'report-backup.db'),
};
