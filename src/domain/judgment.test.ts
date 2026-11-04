import { describe, expect, it } from 'vitest';
import type { Circuit } from '../shared/schema.ts';
import { autoGroundVoltage } from './groundVoltage.ts';
import { criterionFor, judgeCircuit, judgePanel } from './judgment.ts';

type C = Pick<Circuit, 'readings' | 'useVoltage' | 'groundVoltage'>;
const v = (mohm: number) => ({ kind: 'value' as const, mohm });

describe('判定（必須テスト CLAUDE.md §8）', () => {
  it('1φ3W・対地100V・0.12 → 良', () => {
    const c: C = { useVoltage: 200, groundVoltage: 100, readings: { RE: v(0.12) } };
    expect(judgeCircuit(c).verdict).toBe('good');
    expect(judgeCircuit(c).criterion.mohm).toBe(0.1);
  });
  it('3φ3W 200V・0.15 → 否', () => {
    const c: C = { useVoltage: 200, groundVoltage: autoGroundVoltage('3φ3W', 200), readings: { RE: v(0.15) } };
    expect(judgeCircuit(c).criterion.mohm).toBe(0.2);
    expect(judgeCircuit(c).verdict).toBe('bad');
  });
  it('3φ4W 400V・0.4 → 良（境界値）', () => {
    const c: C = { useVoltage: 400, groundVoltage: autoGroundVoltage('3φ4W', 400), readings: { RE: v(0.4) } };
    expect(judgeCircuit(c).criterion.mohm).toBe(0.4);
    expect(judgeCircuit(c).verdict).toBe('good');
  });
  it('全項目 na → 未判定', () => {
    const c: C = { useVoltage: 100, groundVoltage: 100, readings: { RE: { kind: 'na' }, SE: { kind: 'na' }, ALL_E: { kind: 'na' } } };
    expect(judgeCircuit(c).verdict).toBe('none');
    expect(judgeCircuit(c).min).toBeUndefined();
  });
  it('over 2000 → 良', () => {
    const c: C = { useVoltage: 400, groundVoltage: 231, readings: { ALL_E: { kind: 'over', mohm: 2000 } } };
    expect(judgeCircuit(c).verdict).toBe('good');
  });
});

describe('判定（補足）', () => {
  it('最小値で判定し、na は除外する', () => {
    const c: C = { useVoltage: 200, groundVoltage: 200, readings: { RS: v(50), ST: v(0.19), TR: { kind: 'na' } } };
    const j = judgeCircuit(c);
    expect(j.min).toEqual(v(0.19));
    expect(j.verdict).toBe('bad');
  });
  it('未入力のみ → 未判定', () => {
    expect(judgeCircuit({ useVoltage: 100, groundVoltage: 100, readings: {} }).verdict).toBe('none');
  });
  it('基準値の区分', () => {
    expect(criterionFor(100, 100).mohm).toBe(0.1);
    expect(criterionFor(300, 150).mohm).toBe(0.1); // 境界は「以下」
    expect(criterionFor(300, 151).mohm).toBe(0.2);
    expect(criterionFor(301, 100).mohm).toBe(0.4);
  });
  it('1φ2W 100V 0.1 → 良（境界）、0.09 → 否', () => {
    const g = autoGroundVoltage('1φ2W', 100);
    expect(judgeCircuit({ useVoltage: 100, groundVoltage: g, readings: { RE: v(0.1) } }).verdict).toBe('good');
    expect(judgeCircuit({ useVoltage: 100, groundVoltage: g, readings: { RE: v(0.09) } }).verdict).toBe('bad');
  });
});

describe('盤全体の判定', () => {
  const good: C = { useVoltage: 100, groundVoltage: 100, readings: { RE: v(10) } };
  const bad: C = { useVoltage: 100, groundVoltage: 100, readings: { RE: v(0.01) } };
  const none: C = { useVoltage: 100, groundVoltage: 100, readings: {} };
  it('1回路でも否があれば否', () => expect(judgePanel([good, bad, none])).toBe('bad'));
  it('全回路良なら良', () => expect(judgePanel([good, good])).toBe('good'));
  it('未判定を含み否が無ければ未判定', () => expect(judgePanel([good, none])).toBe('none'));
  it('回路0件は未判定', () => expect(judgePanel([])).toBe('none'));
});

describe('対地電圧の自動算出', () => {
  it.each([
    ['1φ2W', 100, 100],
    ['1φ3W', 200, 100],
    ['3φ3W', 200, 200],
    ['3φ4W', 400, 231],
  ] as const)('%s %dV → %dV', (sys, u, g) => expect(autoGroundVoltage(sys, u)).toBe(g));
});
