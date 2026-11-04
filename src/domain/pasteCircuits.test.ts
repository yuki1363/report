import { describe, expect, it } from 'vitest';
import { parsePastedCircuits } from './pasteCircuits.ts';

const d = { system: '3φ3W' as const, useVoltage: 210 };

describe('回路の貼り付け', () => {
  it('Excel からのコピー（タブ区切り）。見出し行は読み飛ばし、空欄は既定値', () => {
    const text = 'ELB No.\t負荷名称\t電気方式\t電圧\tAT\n41\t1FP-2-1, 1FP-2-2, 1FP-2-3\t\t\t350\n43\t溶接機\t3Φ3W\t200\t225\n47\tスペース\n';
    const r = parsePastedCircuits(text, d);
    expect(r.skippedHeader).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.circuits).toEqual([
      { no: '41', name: '1FP-2-1, 1FP-2-2, 1FP-2-3', system: '3φ3W', useVoltage: 210, breakerA: 350, defaulted: ['system', 'useVoltage'] },
      { no: '43', name: '溶接機', system: '3φ3W', useVoltage: 200, breakerA: 225, defaulted: [] },
      { no: '47', name: 'スペース', system: '3φ3W', useVoltage: 210, defaulted: ['system', 'useVoltage'] },
    ]);
  });
  it('名称だけの貼り付けは番号を自動で振る。全角数字・単位つきも可', () => {
    const r = parsePastedCircuits('照明 1F\nコンセント\n', { system: '1φ3W', useVoltage: 200 });
    expect(r.circuits.map((c) => c.no + c.name)).toEqual(['1照明 1F', '2コンセント']);
    const u = parsePastedCircuits('1\t動力\t三相3線\t２００V\t３０A', d);
    expect(u.circuits[0]).toMatchObject({ system: '3φ3W', useVoltage: 200, breakerA: 30 });
  });
  it('2つ以上の空白区切りも使える（名称の中の1つの空白は区切りにしない）', () => {
    const r = parsePastedCircuits('1  照明 1F  1φ3W  200  20', d);
    expect(r.circuits[0]).toMatchObject({ no: '1', name: '照明 1F', system: '1φ3W', useVoltage: 200, breakerA: 20 });
  });
  it('判別できない行は理由つきで返し、他の行は取り込む', () => {
    const r = parsePastedCircuits('1\tA\t2φ3W\t200\n2\tB\t1φ2W\tabc\n3\tC\t1φ2W\t100\t-5\n4\tD', d);
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3]);
    expect(r.errors.map((e) => e.reason)).toEqual([expect.stringContaining('電気方式'), expect.stringContaining('使用電圧'), expect.stringContaining('ブレーカ容量')]);
    expect(r.circuits.map((c) => c.no)).toEqual(['4']);
  });
});
