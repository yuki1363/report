import { describe, expect, it } from 'vitest';
import type { Circuit } from '../shared/schema.ts';
import { newCircuit, nextCircuitNo } from './newCircuit.ts';
import { parsePastedCircuits } from './pasteCircuits.ts';

const prev: Circuit = { id: 'a', no: '01', name: '照明', system: '1φ3W', useVoltage: 210, voltageLabel: '105/210', groundVoltage: 105, testVoltage: 250, readings: {}, source: 'manual' };

describe('回路の追加で、書いたとおりに引き継ぐ', () => {
  it('電圧の表記（105/210）と、回路Noの桁（01 → 02）を引き継ぐ', () => {
    const c = newCircuit(prev, () => 'x');
    expect(c).toMatchObject({ no: '', system: '1φ3W', useVoltage: 210, voltageLabel: '105/210', groundVoltage: 105 });
  });
  it('表記が無ければ付けない。番号の採番', () => {
    const { voltageLabel: _l, ...plain } = prev;
    expect(newCircuit(plain as Circuit, () => 'x').voltageLabel).toBeUndefined();
    expect(nextCircuitNo('9')).toBe('10');
    expect(nextCircuitNo('009')).toBe('010');
    expect(nextCircuitNo('A-1')).toBe('');
  });
  it('貼り付けの既定電圧を「105/210」と書くと、電圧が空欄の行にも表記が付く', () => {
    const r = parsePastedCircuits('1\t照明\t\t20\n2\t動力\t\t\t\t440', { voltage: '105/210' });
    expect(r.circuits.map((c) => c.voltageLabel)).toEqual(['105/210', undefined]); // 行に電圧があればそちらを優先
    expect(r.circuits.map((c) => c.useVoltage)).toEqual([210, 440]);
  });
});

describe('最初の回路', () => {
  it('1φ3W・105/210（対地 105V）で始まる', () => {
    expect(newCircuit(undefined, () => 'x')).toMatchObject({ no: '', system: '1φ3W', useVoltage: 210, voltageLabel: '105/210', groundVoltage: 105 });
  });
});
