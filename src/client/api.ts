import type { Report, ReportSummary, Settings, Criteria } from '../shared/schema.ts';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface SettingsResponse {
  settings: Settings;
  criteria: Criteria;
  model: string;
  apiKeyConfigured: boolean;
}

export const api = {
  listReports: () => call<ReportSummary[]>('/api/reports'),
  createReport: (from?: string, mode?: 'copy' | 'inherit') =>
    call<Report>('/api/reports', { method: 'POST', body: JSON.stringify(from ? { from, mode } : {}) }),
  getReport: (id: string) => call<Report>(`/api/reports/${id}`),
  saveReport: (r: Report) => call<Report>(`/api/reports/${r.id}`, { method: 'PUT', body: JSON.stringify(r) }),
  deleteReport: (id: string) => call<void>(`/api/reports/${id}`, { method: 'DELETE' }),
  listTemplates: () => call<{ id: string; name: string }[]>('/api/templates'),
  getSettings: () => call<SettingsResponse>('/api/settings'),
  saveSettings: (s: Settings) => call<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),
  async downloadPdf(id: string): Promise<void> {
    const res = await fetch(`/api/reports/${id}/pdf`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `PDF 出力に失敗しました (${res.status})`);
    }
    const cd = res.headers.get('content-disposition') ?? '';
    const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
    const name = m ? decodeURIComponent(m[1]!) : 'report.pdf';
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};
