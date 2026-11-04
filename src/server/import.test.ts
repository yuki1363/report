import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ImportRecord } from '../shared/extraction.ts';
import type { Report } from '../shared/schema.ts';
import { createApp } from './app.ts';
import { Store } from './db.ts';

const store = new Store(':memory:');
const dataDir = mkdtempSync(join(tmpdir(), 'report-import-'));
const calls: string[] = [];
const app = createApp({
  store,
  dataDir,
  pdf: async () => Buffer.from('%PDF'),
  extractors: {
    ai: async (_d, _id, pages) => {
      calls.push(`ai:${pages.length}`);
      return {
        model: 'test-model',
        result: {
          panels: [
            {
              name: '電灯盤 L-1',
              location: null,
              circuits: [{ no: '1', name: '照明', system: '1φ3W', useVoltage: 200, breakerA: 20 }, { no: '2', name: null, system: null, useVoltage: 100, breakerA: null }],
            },
            { name: '電灯盤 L-2', location: null, circuits: [{ no: '1', name: '予備', system: '1φ2W', useVoltage: 100, breakerA: null }] },
          ],
          uncertain: [{ field: 'panels.0.circuits.1.name', reason: 'かすれ' }],
        },
      };
    },
    ocr: async (_d, _id, pages) => {
      calls.push(`ocr:${pages.length}`);
      return { panels: [{ name: null, location: null, circuits: [] }], uncertain: [] };
    },
    megger: async () => ({ kind: 'value', mohm: 52.3, displayText: '52.3MΩ', reason: null }),
  },
});
afterAll(() => {
  store.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const base = 'http://localhost:8787';
const H = { host: 'localhost:8787' };
const json = (path: string, method: string, body: unknown) =>
  app.request(base + path, { method, body: JSON.stringify(body), headers: { ...H, 'content-type': 'application/json' } });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function upload(extra: Record<string, string> = {}, header = true) {
  const fd = new FormData();
  fd.append('source', new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], '単線結線図.pdf', { type: 'application/pdf' }));
  fd.append('page', new File([PNG], 'p1.png', { type: 'image/png' }));
  fd.append('page', new File([PNG], 'p2.png', { type: 'image/png' }));
  fd.append('meta', JSON.stringify([
    { fileIndex: 0, pageNo: 1, kind: 'pdf-text', width: 100, height: 100, text: '10,10: 電灯盤' },
    { fileIndex: 0, pageNo: 2, kind: 'pdf-scan', width: 100, height: 100 },
  ]));
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return app.request(base + '/api/imports', { method: 'POST', body: fd, headers: header ? { ...H, 'x-report-app': '1' } : H });
}

describe('取込 → 読み取り → 確認・確定', () => {
  let rec: ImportRecord;

  it('独自ヘッダの無い multipart は拒否（CSRF 対策）', async () => {
    expect((await upload({}, false)).status).toBe(415);
  });

  it('アップロード', async () => {
    const res = await upload();
    expect(res.status).toBe(201);
    rec = (await res.json()) as ImportRecord;
    expect(rec.pages.map((p) => p.fileName)).toEqual(['単線結線図.pdf', '単線結線図.pdf']);
    const img = await app.request(`${base}/api/imports/${rec.id}/pages/1`, { headers: H });
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);
  });

  it('AI OFF（既定）のときは OCR を使う', async () => {
    const r = (await (await json(`/api/imports/${rec.id}/extract`, 'POST', {})).json()) as ImportRecord;
    expect(r.engine).toBe('ocr');
    expect(calls).toEqual(['ocr:2']);
  });

  it('AI ON のときは Claude を使い、結果は確定まで報告書に反映しない', async () => {
    store.saveSettings({ ...store.getSettings(), aiExtraction: true });
    const r = (await (await json(`/api/imports/${rec.id}/extract`, 'POST', {})).json()) as ImportRecord;
    expect(r).toMatchObject({ engine: 'ai', model: 'test-model', status: 'extracted' });
    expect(r.result!.uncertain).toContainEqual({ field: 'panels.0.circuits.1.name', reason: 'かすれ' });
    expect(r.result!.panels).toHaveLength(2);
    expect(store.listReports()).toEqual([]);
  });

  it('確定（盤が2面 → 報告書が2件）', async () => {
    const res = await json(`/api/imports/${rec.id}/confirm`, 'POST', {
      mode: 'new', applyPanel: true,
      panels: [
        { panel: { name: '電灯盤 L-1', location: '' }, circuits: [{ no: '1', name: '照明', system: '1φ3W', useVoltage: 200, breakerA: 20 }, { no: '2', name: '予備', system: '1φ2W', useVoltage: 100 }] },
        { panel: { name: '電灯盤 L-2', location: '2F' }, circuits: [{ no: '1', name: '予備', system: '1φ2W', useVoltage: 100 }] },
      ],
    });
    expect(res.status).toBe(200);
    const { reports } = (await res.json()) as { reports: Report[] };
    expect(reports.map((r) => `${r.panel.name}:${r.circuits.length}`)).toEqual(['電灯盤 L-1:2', '電灯盤 L-2:1']);
    expect(reports[0]!.circuits.map((c) => c.source)).toEqual(['ai', 'ai']);
    expect(reports[0]!.sourceFiles).toEqual([`imports/${rec.id}/src-0.pdf`]);
    expect((await json(`/api/imports/${rec.id}/confirm`, 'POST', {})).status).toBe(409);
  });

  it('既存の報告書へ反映できる盤は1つだけ', async () => {
    const r3 = (await (await upload()).json()) as ImportRecord;
    // 並び順に頼らず、盤名で対象を決める（L-1 は回路2件）
    const target = store.listReports().find((r) => r.panelName === '電灯盤 L-1')!.id;
    const p = { panel: { name: 'x', location: '' }, circuits: [{ no: '1', name: 'a', system: '1φ2W', useVoltage: 100 }] };
    const res = await json(`/api/imports/${r3.id}/confirm`, 'POST', { mode: 'append', targetReportId: target, applyPanel: false, panels: [p, p] });
    expect(res.status).toBe(400);
    const ok = await json(`/api/imports/${r3.id}/confirm`, 'POST', { mode: 'append', targetReportId: target, applyPanel: false, panels: [p] });
    expect(((await ok.json()) as { reports: Report[] }).reports[0]!.circuits.length).toBe(3);
  });

  it('未確定の値（電気方式なし）は確定できない', async () => {
    const r2 = (await (await upload()).json()) as ImportRecord;
    const res = await json(`/api/imports/${r2.id}/confirm`, 'POST', {
      mode: 'new', applyPanel: true, panels: [{ panel: { name: 'x', location: '' }, circuits: [{ no: '1', name: 'a', useVoltage: 100 }] }],
    });
    expect(res.status).toBe(400);
  });

  it('メガー写真の読み取り（AI ON のとき）', async () => {
    const fd = new FormData();
    fd.append('image', new File([PNG], 'm.png', { type: 'image/png' }));
    const res = await app.request(base + '/api/megger', { method: 'POST', body: fd, headers: { ...H, 'x-report-app': '1' } });
    expect(await res.json()).toMatchObject({ kind: 'value', mohm: 52.3 });
  });
});

describe('テンプレート・Excel・バックアップ', () => {
  it('名前を付けて保存 → 一覧 → 上書き → 削除。既定テンプレートは上書き不可', async () => {
    const t = (await (await app.request(base + '/api/templates/default', { headers: H })).json()) as { sheet: unknown };
    const created = (await (await json('/api/templates', 'POST', { name: '社内様式A', sheet: t.sheet })).json()) as { id: string };
    const list = (await (await app.request(base + '/api/templates', { headers: H })).json()) as { name: string; builtin: boolean }[];
    expect(list.map((x) => `${x.name}:${x.builtin}`)).toEqual(['標準（A4縦）:true', '社内様式A:false']);
    expect((await json(`/api/templates/${created.id}`, 'PUT', { name: '社内様式B', sheet: t.sheet })).status).toBe(200);
    expect((await json('/api/templates/default', 'PUT', { name: 'x', sheet: t.sheet })).status).toBe(404);
    expect((await app.request(`${base}/api/templates/${created.id}`, { method: 'DELETE', headers: H })).status).toBe(200);
  });

  it('Excel とバックアップのダウンロード', async () => {
    const id = store.listReports()[0]!.id;
    const x = await app.request(`${base}/api/reports/${id}/xlsx`, { headers: H });
    expect(x.headers.get('content-type')).toContain('spreadsheetml');
    expect(new Uint8Array(await x.arrayBuffer()).subarray(0, 2)).toEqual(new Uint8Array([0x50, 0x4b])); // zip
    const b = await app.request(`${base}/api/backup`, { headers: H });
    expect(Buffer.from(await b.arrayBuffer()).subarray(0, 15).toString()).toBe('SQLite format 3');
  });
});
