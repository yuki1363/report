import { describe, expect, it } from 'vitest';
import type { Circuit, Report } from '../shared/schema.ts';
import { comparePrevious, findPrevious } from './compare.ts';
import { applyConfirmation, defaultTestVoltage } from './importing.ts';

const c = (id: string, no: string, name: string, mohm?: number): Circuit => ({
  id, no, name, system: '1φ3W', useVoltage: 200, groundVoltage: 100, testVoltage: 250,
  readings: mohm === undefined ? {} : { RE: { kind: 'value', mohm } }, source: 'manual',
});
const r = (id: string, date: string, name: string, circuits: Circuit[]): Report => ({
  id, templateId: 'default', panel: { name }, date, inspector: '', instrument: { model: '' }, circuits, sourceFiles: [],
});

describe('前回値との比較', () => {
  const prev1 = r('p1', '2025-11-01', '電灯盤 L-1', [c('a', '1', '照明', 100), c('b', '2', 'コンセント', 50)]);
  const prev0 = r('p0', '2024-11-01', '電灯盤 L-1', [c('a', '1', '照明', 999)]);
  const other = r('x', '2026-01-01', '動力盤', []);
  const cur = r('now', '2026-11-04', '電灯盤L-1', [c('1', '1', '照明', 40), c('2', '2', 'コンセント(改)', 45), c('3', '3', '新設', 1)]);

  it('同じ盤名（空白無視）で直近の過去の報告書を選ぶ', () => {
    expect(findPrevious(cur, [prev0, prev1, other, cur])?.id).toBe('p1');
  });
  it('回路を対応付け、半分未満に下がったものを検出', () => {
    const cmp = comparePrevious(cur, [prev0, prev1, other]);
    expect(cmp.previous).toEqual({ id: 'p1', date: '2025-11-01' });
    expect(cmp.circuits[0]).toMatchObject({ ratio: 0.4, dropped: true });
    expect(cmp.circuits[1]).toMatchObject({ ratio: 0.9, dropped: false }); // 名称違いでも No が一意なら対応
    expect(cmp.circuits[2]).toEqual({ circuitId: '3', dropped: false });
  });
  it('前回が無い場合', () => {
    expect(comparePrevious(cur, [other]).previous).toBeUndefined();
  });
});

describe('取込の確定', () => {
  let n = 0;
  const id = () => `id${n++}`;
  const body = {
    mode: 'append' as const, applyPanel: false, panel: { name: '新盤名', location: '2F' },
    circuits: [{ no: '9', name: '動力', system: '3φ4W' as const, useVoltage: 400, breakerA: 30 }],
  };
  it('追加: 既存回路の後ろに、対地電圧・測定電圧を自動設定して追加', () => {
    const base = r('t', '2026-11-04', '旧盤名', [c('a', '1', '照明')]);
    const out = applyConfirmation(base, body, 'ai', ['imports/x/src-0.pdf'], id);
    expect(out.circuits.map((x) => x.no)).toEqual(['1', '9']);
    expect(out.circuits[1]).toMatchObject({ groundVoltage: 231, testVoltage: 500, breakerA: 30, source: 'ai', readings: {} });
    expect(out.panel.name).toBe('旧盤名');
    expect(out.sourceFiles).toEqual(['imports/x/src-0.pdf']);
  });
  it('置き換え＋盤情報の反映', () => {
    const base = r('t', '2026-11-04', '旧盤名', [c('a', '1', '照明')]);
    const out = applyConfirmation(base, { ...body, mode: 'replace', applyPanel: true }, 'ocr', [], id);
    expect(out.circuits.length).toBe(1);
    expect(out.panel).toEqual({ name: '新盤名', location: '2F' });
  });
  it('測定電圧の既定値', () => {
    expect(defaultTestVoltage(100)).toBe(250);
    expect(defaultTestVoltage(400)).toBe(500);
  });
});
