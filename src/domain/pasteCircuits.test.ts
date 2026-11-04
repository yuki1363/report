import { describe, expect, it } from 'vitest';
import { parsePastedCircuits } from './pasteCircuits.ts';

const d = { voltage: '210' };

describe('回路の貼り付け（電気方式と電圧の連動）', () => {
  it('Excel からのコピー。見出し行は読み飛ばし、空欄は既定の電圧（210 → 3φ3W）', () => {
    const text = 'ELB No.\t負荷名称\t電気方式\t電圧\tAT\n41\t1FP-2-1, 1FP-2-2, 1FP-2-3\t\t\t350\n43\t溶接機\t3Φ3W\t440\t225\n47\tスペース\n';
    const r = parsePastedCircuits(text, d);
    expect(r.skippedHeader).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.circuits).toEqual([
      { no: '41', name: '1FP-2-1, 1FP-2-2, 1FP-2-3', system: '3φ3W', useVoltage: 210, breakerA: 350, defaulted: ['system', 'useVoltage'] },
      { no: '43', name: '溶接機', system: '3φ3W', useVoltage: 440, breakerA: 225, defaulted: [] },
      { no: '47', name: 'スペース', system: '3φ3W', useVoltage: 210, defaulted: ['system', 'useVoltage'] },
    ]);
  });
  it('電圧だけ書けば電気方式が決まる（105 → 1φ2W、105/210 → 1φ3W、440 → 3φ3W）', () => {
    const r = parsePastedCircuits('1\tA\t\t105\n2\tB\t\t105/210\n3\tC\t\t440V\n4\tD\t\t１０５／２１０', d);
    expect(r.circuits.map((c) => `${c.system}:${c.voltageLabel ?? c.useVoltage}`)).toEqual(['1φ2W:105', '1φ3W:105/210', '3φ3W:440', '1φ3W:105/210']);
  });
  it('電気方式だけ書けば電圧が決まる。3φ3W は既定の電圧（440 など）が合えばそれを使う', () => {
    const r = parsePastedCircuits('1\tA\t1φ2W\n2\tB\t1ファイ3\n3\tC\t3φ3W', { voltage: '440' });
    expect(r.circuits.map((c) => `${c.system}:${c.voltageLabel ?? c.useVoltage}`)).toEqual(['1φ2W:105', '1φ3W:105/210', '3φ3W:440']);
  });
  it('名称だけの貼り付けは番号を自動で振り、既定の電圧を使う', () => {
    const r = parsePastedCircuits('照明 1F\nコンセント\n', { voltage: '105/210' });
    expect(r.circuits.map((c) => `${c.no}${c.name}:${c.system}:${c.voltageLabel}`)).toEqual(['1照明 1F:1φ3W:105/210', '2コンセント:1φ3W:105/210']);
  });
  it('2つ以上の空白区切りも使える（名称の中の1つの空白は区切りにしない）', () => {
    const r = parsePastedCircuits('1  照明 1F  1φ3W  105/210  20', d);
    expect(r.circuits[0]).toMatchObject({ no: '1', name: '照明 1F', system: '1φ3W', useVoltage: 210, voltageLabel: '105/210', breakerA: 20 });
  });
  it('3φ4W は使えない。方式と電圧の組み合わせが合わない行も弾く', () => {
    const r = parsePastedCircuits('1\tA\t3φ4W\t440\n2\tB\t1φ3W\t440\n3\tC\t3φ3W\t105\n4\tD\t3φ3W\t210', d);
    expect(r.circuits.map((c) => c.no)).toEqual(['4']);
    expect(r.errors[0]!.reason).toContain('使えません');
    expect(r.errors[1]!.reason).toContain('105/210 です');
    expect(r.errors[2]!.reason).toContain('210 または 440');
  });
  it('高圧（600V 超）・パターン外の電圧・数値でない値は理由つきで弾き、他の行は取り込む', () => {
    const r = parsePastedCircuits('1\t高圧受電\t\t6600\n2\tB\t\t200\n3\tC\t\tabc\n4\tD\t\t210\t-5\n5\tE', d);
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3, 4]);
    expect(r.errors[0]!.reason).toContain('低圧');
    expect(r.errors[1]!.reason).toContain('105 / 105/210 / 210 / 440');
    expect(r.errors[3]!.reason).toContain('ブレーカ容量');
    expect(r.circuits.map((c) => c.no)).toEqual(['5']);
  });
});
