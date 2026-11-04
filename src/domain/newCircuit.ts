/** 回路を1行追加するときの初期値（直前の回路の方式・電圧・表記を引き継ぐ）。純粋関数。 */
import type { Circuit } from '../shared/schema.ts';
import { autoGroundVoltage, DEFAULT_USE_VOLTAGE } from './groundVoltage.ts';
import { defaultTestVoltage } from './importing.ts';

/** 回路Noの次の番号。「01」の次は「02」のように、桁（0埋め）をそろえる。数字でなければ空 */
export function nextCircuitNo(prev: string): string {
  if (!/^\d+$/.test(prev)) return '';
  const next = String(Number(prev) + 1);
  return /^0\d*$/.test(prev) ? next.padStart(prev.length, '0') : next;
}

export function newCircuit(prev?: Circuit, newId: () => string = () => crypto.randomUUID()): Circuit {
  const system = prev?.system ?? '1φ3W';
  const useVoltage = prev?.useVoltage ?? DEFAULT_USE_VOLTAGE[system];
  const nextNo = prev ? nextCircuitNo(prev.no) : '';
  return {
    id: newId(),
    no: nextNo || (prev ? '' : '1'),
    name: '',
    system,
    useVoltage,
    // 「105/210」のような電圧の表記も引き継ぐ
    ...(prev?.voltageLabel ? { voltageLabel: prev.voltageLabel } : {}),
    groundVoltage: autoGroundVoltage(system, useVoltage),
    testVoltage: prev?.testVoltage ?? defaultTestVoltage(useVoltage),
    readings: {},
    source: 'manual',
  };
}
