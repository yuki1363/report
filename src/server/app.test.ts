import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Report } from '../shared/schema.ts';
import { contentDisposition, createApp } from './app.ts';
import { Store } from './db.ts';

const store = new Store(':memory:');
const dataDir = mkdtempSync(join(tmpdir(), 'report-test-'));
let lastHtml = '';
const app = createApp({
  store,
  dataDir,
  pdf: async (html) => {
    lastHtml = html;
    return Buffer.from('%PDF-fake');
  },
});
afterAll(() => {
  store.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const H = { host: 'localhost:8787', 'content-type': 'application/json' };
const req = (path: string, init: RequestInit = {}) =>
  app.request(`http://localhost:8787${path}`, { ...init, headers: { ...H, ...(init.headers as object) } });

describe('API', () => {
  let report: Report;

  it('新規作成 → 取得', async () => {
    const res = await req('/api/reports', { method: 'POST', body: '{}' });
    expect(res.status).toBe(201);
    report = (await res.json()) as Report;
    expect(report.templateId).toBe('default');
    const got = await req(`/api/reports/${report.id}`);
    expect(((await got.json()) as Report).id).toBe(report.id);
  });

  it('保存（zod 検証）', async () => {
    report.panel = { name: '電灯盤 L-1', location: '1F' };
    report.inspector = '髙橋';
    report.circuits = [
      {
        id: 'a',
        no: '1',
        name: '照明',
        system: '1φ3W',
        useVoltage: 200,
        groundVoltage: 100,
        testVoltage: 250,
        readings: { RE: { kind: 'value', mohm: 0.12 } },
        source: 'manual',
      },
    ];
    const res = await req(`/api/reports/${report.id}`, { method: 'PUT', body: JSON.stringify(report) });
    expect(res.status).toBe(200);
    const list = (await (await req('/api/reports')).json()) as { panelName: string; circuitCount: number }[];
    expect(list[0]).toMatchObject({ panelName: '電灯盤 L-1', circuitCount: 1 });
  });

  it('不正なデータは 400', async () => {
    const bad = { ...report, circuits: [{ ...report.circuits[0], system: '2φ' }] };
    const res = await req(`/api/reports/${report.id}`, { method: 'PUT', body: JSON.stringify(bad) });
    expect(res.status).toBe(400);
  });

  it('複製と前回値の引き継ぎ', async () => {
    const copy = (await (await req('/api/reports', { method: 'POST', body: JSON.stringify({ from: report.id, mode: 'copy' }) })).json()) as Report;
    expect(copy.id).not.toBe(report.id);
    expect(copy.circuits[0]!.readings.RE).toEqual({ kind: 'value', mohm: 0.12 });
    const inh = (await (await req('/api/reports', { method: 'POST', body: JSON.stringify({ from: report.id, mode: 'inherit' }) })).json()) as Report;
    expect(inh.circuits[0]!.name).toBe('照明');
    expect(inh.circuits[0]!.readings).toEqual({});
  });

  it('HTML プレビューと PDF', async () => {
    const html = await (await req(`/api/reports/${report.id}/html`)).text();
    expect(html).toContain('電灯盤 L-1');
    expect(html).toContain('良');
    const res = await req(`/api/reports/${report.id}/pdf`);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''");
    expect(lastHtml).toBe(html);
  });

  it('削除', async () => {
    expect((await req(`/api/reports/${report.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await req(`/api/reports/${report.id}`)).status).toBe(404);
  });

  it('設定の既定値は AI 読み取り OFF', async () => {
    const s = (await (await req('/api/settings')).json()) as { settings: { aiExtraction: boolean }; criteria: { highMohm: number } };
    expect(s.settings.aiExtraction).toBe(false);
    expect(s.criteria.highMohm).toBe(0.4);
  });

  it('localhost 以外の Host / 他サイトからの送信は拒否', async () => {
    expect((await req('/api/reports', { headers: { host: 'evil.example' } })).status).toBe(403);
    expect((await req('/api/reports', { method: 'POST', body: '{}', headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await req('/api/reports', { method: 'POST', body: 'x=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status).toBe(415);
  });

  it('Content-Disposition は日本語ファイル名を RFC 5987 で付ける', () => {
    expect(contentDisposition('報告書.pdf')).toBe(`attachment; filename="___.pdf"; filename*=UTF-8''${encodeURIComponent('報告書.pdf')}`);
  });
});
