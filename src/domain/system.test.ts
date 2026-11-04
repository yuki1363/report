import { describe, expect, it } from 'vitest';
import { autoGroundVoltage } from './groundVoltage.ts';
import { judgeCircuit } from './judgment.ts';
import { parsePastedCircuits } from './pasteCircuits.ts';
import { normalizeSystem, parseVoltage } from './system.ts';

describe('電気方式の表記', () => {
  it.each([
    ['1ファイ3', '1φ3W'],
    ['1ファイ3W', '1φ3W'],
    ['3ファイ3線', '3φ3W'],
    ['1ふぁい2', '1φ2W'],
    ['1φ3', '1φ3W'],
    ['１Φ３Ｗ', '1φ3W'],
    ['単相3線', '1φ3W'],
    ['3ファイ5', null],
    ['2ファイ3', null],
  ])('%s → %s', (s, v) => expect(normalizeSystem(s)).toBe(v));
});

describe('電圧の入力', () => {
  it.each([
    ['105/210', 210],
    ['105/210V', 210],
    ['１００／２００', 200],
    ['210', 210],
    ['210V', 210],
    ['1,000', 1000],
    ['', undefined],
  ])('%j → %j', (s, v) => expect(parseVoltage(s)).toBe(v));
  it.each(['abc', '1/2/3', '105/', '/210'])('%j は数値にできない', (s) => expect(parseVoltage(s)).toBeNaN());
});

describe('105/210V 1φ3W', () => {
  it('使用電圧 210V、対地電圧 105V、基準値 0.1MΩ', () => {
    const r = parsePastedCircuits('1\t照明\t1ファイ3\t105/210\t20', { system: '3φ3W', useVoltage: 200 });
    expect(r.errors).toEqual([]);
    const c = r.circuits[0]!;
    expect(c).toMatchObject({ system: '1φ3W', useVoltage: 210, breakerA: 20 });
    const ground = autoGroundVoltage(c.system, c.useVoltage);
    expect(ground).toBe(105);
    const j = judgeCircuit({ useVoltage: c.useVoltage, groundVoltage: ground, readings: { RE: { kind: 'value', mohm: 0.1 } } });
    expect(j.criterion.mohm).toBe(0.1);
    expect(j.verdict).toBe('good');
  });
});

describe('電圧の表記を残す', () => {
  it('「105/210」は表記を残し、それ以外は残さない', async () => {
    const { voltageLabel } = await import('./system.ts');
    expect(voltageLabel('105/210')).toBe('105/210');
    expect(voltageLabel('１０５／２１０V')).toBe('105/210');
    expect(voltageLabel('210')).toBeUndefined();
    expect(voltageLabel('1/2/3')).toBeUndefined();
  });
  it('貼り付けた表記が帳票の差し込み値になる（判定は大きい方の 210V）', async () => {
    const { generateSheet } = await import('./generate.ts');
    const { parsePastedCircuits } = await import('./pasteCircuits.ts');
    const c = parsePastedCircuits('1\t照明\t1ファイ3\t105/210', { system: '3φ3W', useVoltage: 200 }).circuits[0]!;
    expect(c.voltageLabel).toBe('105/210');
    const sheet = generateSheet(
      { page: { size: 'A4', orientation: 'portrait', marginsMm: { t: 1, r: 1, b: 1, l: 1 } }, colWidthsMm: [10], rowHeightsMm: [5], cells: { '0,0': { value: '{{c.useVoltage}}' } }, merges: [], images: [], repeatRegion: { rowStart: 0, rowEnd: 0, source: 'circuits' } },
      { id: 'r', templateId: 'default', panel: { name: '' }, date: '', inspector: '', instrument: { model: '' }, sourceFiles: [],
        circuits: [{ id: 'c', no: c.no, name: c.name, system: c.system, useVoltage: c.useVoltage, voltageLabel: c.voltageLabel!, groundVoltage: 105, testVoltage: 250, readings: {}, source: 'manual' }] },
    );
    expect(sheet.cells['0,0']!.value).toBe('105/210');
  });
});
