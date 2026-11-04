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
