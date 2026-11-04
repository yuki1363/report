/** 回路を1行追加するときの初期値（直前の回路の方式・電圧・表記を引き継ぐ）。純粋関数。 */
import type { Circuit } from '../shared/schema.ts';
import { defaultTestVoltage } from './importing.ts';
import { applySystem } from './voltagePattern.ts';

/** 回路Noの次の番号。「01」の次は「02」のように、桁（0埋め）をそろえる。数字でなければ空 */
export function nextCircuitNo(prev: string): string {
  if (!/^\d+$/.test(prev)) return '';
  const next = String(Number(prev) + 1);
  return /^0\d*$/.test(prev) ? next.padStart(prev.length, '0') : next;
}

export function newCircuit(prev?: Circuit, newId: () => string = () => crypto.randomUUID()): Circuit {
  const nextNo = prev ? nextCircuitNo(prev.no) : '';
  // 直前の回路の方式・電圧（表記も）を引き継ぐ。最初の回路は 1φ3W（105/210）
  const base: Circuit = {
    id: newId(),
    no: nextNo || (prev ? '' : '1'),
    name: '',
    system: prev?.system ?? '1φ3W',
    useVoltage: prev?.useVoltage ?? 210,
    ...(prev?.voltageLabel ? { voltageLabel: prev.voltageLabel } : {}),
    groundVoltage: prev?.groundVoltage ?? 105,
    testVoltage: prev?.testVoltage ?? defaultTestVoltage(prev?.useVoltage ?? 210),
    readings: {},
    source: 'manual',
  };
  return prev ? base : applySystem({ ...base, useVoltage: 0 }, base.system);
}
