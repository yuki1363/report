import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TemplateSchema, type Circuit, type Report, type Sheet } from '../shared/schema.ts';
import { generateSheet, resolveBindings } from './generate.ts';
import { applyNumFmt, renderSheetHtml, widthOverflowMm } from './renderHtml.ts';

const template = TemplateSchema.parse(JSON.parse(readFileSync(new URL('../../templates/default.json', import.meta.url), 'utf8')));

const circuit = (i: number, over: Partial<Circuit> = {}): Circuit => ({
  id: `c${i}`,
  no: String(i),
  name: `動力${i}`,
  system: '3φ3W',
  useVoltage: 200,
  groundVoltage: 200,
  testVoltage: 500,
  readings: { RE: { kind: 'value', mohm: 50 }, SE: { kind: 'na' }, ALL_E: { kind: 'over', mohm: 2000 } },
  source: 'manual',
  ...over,
});

const report = (n: number): Report => ({
  id: 'r1',
  templateId: 'default',
  panel: { name: 'P-1 動力盤', location: '髙橋ビル B1F 電気室' },
  date: '2026-11-04',
  inspector: '髙橋 太郎',
  instrument: { model: 'MΩ計 3φ対応', serial: 'S-01' },
  circuits: Array.from({ length: n }, (_, i) => circuit(i + 1)),
  sourceFiles: [],
});

const mini: Sheet = {
  page: { size: 'A4', orientation: 'portrait', marginsMm: { t: 10, r: 10, b: 10, l: 10 }, repeatHeaderRows: [1, 1] },
  colWidthsMm: [20, 30],
  rowHeightsMm: [10, 6, 7, 8, 9],
  cells: {
    '0,0': { value: '{{panel.name}}' },
    '1,0': { value: 'No' },
    '2,0': { value: '{{c.no}}' },
    '2,1': { value: '{{c.name}}' },
    '3,0': { value: '{{c.judgment}}' },
    '4,0': { value: '計 {{report.circuitCount}} / {{report.judgment}} / {{unknown}}' },
  },
  merges: [
    { r1: 0, c1: 0, r2: 0, c2: 1 },
    { r1: 3, c1: 0, r2: 3, c2: 1 },
    { r1: 4, c1: 0, r2: 4, c2: 1 },
  ],
  repeatRegion: { rowStart: 2, rowEnd: 3, source: 'circuits' },
  images: [],
};

describe('generateSheet（repeatRegion 展開）', () => {
  it('2行ブロックを回路数ぶん複製し、後続行・結合をずらす', () => {
    const s = generateSheet(mini, report(3));
    expect(s.rowHeightsMm).toEqual([10, 6, 7, 8, 7, 8, 7, 8, 9]);
    expect(s.cells['2,0']!.value).toBe('1');
    expect(s.cells['4,1']!.value).toBe('動力2');
    expect(s.cells['6,0']!.value).toBe('3');
    expect(s.cells['7,0']!.value).toBe('良');
    expect(s.cells['8,0']!.value).toBe('計 3 / 良 / {{unknown}}');
    expect(s.merges).toContainEqual({ r1: 3, c1: 0, r2: 3, c2: 1 });
    expect(s.merges).toContainEqual({ r1: 5, c1: 0, r2: 5, c2: 1 });
    expect(s.merges).toContainEqual({ r1: 7, c1: 0, r2: 7, c2: 1 });
    expect(s.merges).toContainEqual({ r1: 8, c1: 0, r2: 8, c2: 1 });
    expect(s.repeatRegion).toBeUndefined();
  });

  it('回路0件でも空の1ブロックを出す', () => {
    const s = generateSheet(mini, report(0));
    expect(s.rowHeightsMm.length).toBe(5);
    expect(s.cells['2,0']!.value).toBe('');
    expect(s.cells['4,0']!.value).toBe('計 0 / 未判定 / {{unknown}}');
  });

  it('既定テンプレート: 判定・測定値の表記', () => {
    const s = generateSheet(template.sheet, report(2));
    const row = 8; // 最初の回路行
    expect(s.cells[`${row},1`]!.value).toBe('動力1');
    expect(s.cells[`${row},9`]!.value).toBe('50'); // RE
    expect(s.cells[`${row},10`]!.value).toBe('-'); // SE (na)
    expect(s.cells[`${row},13`]!.value).toBe('>2000'); // ALL_E
    expect(s.cells[`${row},14`]!.value).toBe('50'); // 最小値
    expect(s.cells[`${row},15`]!.value).toBe('0.2'); // 基準値
    expect(s.cells[`${row},16`]!.value).toBe('良');
    expect(s.page.repeatHeaderRows).toEqual([6, 7]);
    // 総合判定は回路2件ぶん下にずれる
    expect(s.cells['11,3']!.value).toBe('良');
  });

  it('既定テンプレートは用紙幅に収まる', () => {
    expect(widthOverflowMm(template.sheet)).toBe(0);
  });
});

describe('renderSheetHtml', () => {
  it('結合・見出し行(thead)・エスケープ', () => {
    const r = report(1);
    r.panel.name = '<盤>&"Ω"';
    const html = renderSheetHtml(generateSheet(mini, r));
    expect(html).toContain('colspan="2"');
    expect(html).toContain('<thead>');
    expect(html).toContain('&lt;盤&gt;&amp;&quot;Ω&quot;');
    expect(html).not.toContain('<盤>');
    expect(html).toContain('@page { size: A4 portrait');
  });
  it('見出し行の境界をまたぐ結合がある場合は thead を使わない', () => {
    const s: Sheet = { ...mini, repeatRegion: undefined, merges: [{ r1: 0, c1: 0, r2: 1, c2: 0 }] };
    expect(renderSheetHtml(s)).not.toContain('<thead>');
  });
  it('numFmt', () => {
    expect(applyNumFmt('0.1', '0.00')).toBe('0.10');
    expect(applyNumFmt('>2000', '0.00')).toBe('>2000');
    expect(applyNumFmt('3', '0')).toBe('3');
  });
});

describe('バインド置換', () => {
  it('空白入りのキーも置換', () => expect(resolveBindings('{{ a.b }}-{{a.b}}', { 'a.b': 'x' })).toBe('x-x'));
});
