import { describe, expect, it } from 'vitest';
import { parsePastedCircuits } from './pasteCircuits.ts';

const d = { voltage: '210' };

describe('回路の貼り付け（回路No / 回路名称 / 種別 / 容量 / 電気方式 / 使用電圧）', () => {
  it('Excel からのコピー。見出し行は読み飛ばし、種別・容量・電気方式・電圧を読む。空欄は既定の電圧（210 → 3φ3W）', () => {
    const text = 'ELB No.\t負荷名称\t種別\t容量\t電気方式\t電圧\n41\t1FP-2-1, 1FP-2-2\tELB\t350\n43\t溶接機\tMg\t225\t3Φ3W\t440\n47\tスペース\n';
    const r = parsePastedCircuits(text, d);
    expect(r.skippedHeader).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.circuits).toEqual([
      { no: '41', name: '1FP-2-1, 1FP-2-2', deviceType: 'ELB', breakerA: 350, system: '3φ3W', useVoltage: 210, defaulted: ['system', 'useVoltage'] },
      { no: '43', name: '溶接機', deviceType: 'Mg', breakerA: 225, system: '3φ3W', useVoltage: 440, defaulted: [] },
      { no: '47', name: 'スペース', system: '3φ3W', useVoltage: 210, defaulted: ['system', 'useVoltage'] },
    ]);
  });
  it('電圧だけ書けば電気方式が決まる（105 → 1φ2W、105/210 → 1φ3W、440 → 3φ3W）', () => {
    const r = parsePastedCircuits('1\tA\t\t\t\t105\n2\tB\t\t\t\t105/210\n3\tC\t\t\t\t440V\n4\tD\t\t\t\t１０５／２１０', d);
    expect(r.circuits.map((c) => `${c.system}:${c.voltageLabel ?? c.useVoltage}`)).toEqual(['1φ2W:105', '1φ3W:105/210', '3φ3W:440', '1φ3W:105/210']);
  });
  it('電気方式だけ書けば電圧が決まる。3φ3W は既定の電圧（440 など）が合えばそれを使う', () => {
    const r = parsePastedCircuits('1\tA\t\t\t1φ2W\n2\tB\t\t\t1ファイ3\n3\tC\t\t\t3φ3W', { voltage: '440' });
    expect(r.circuits.map((c) => `${c.system}:${c.voltageLabel ?? c.useVoltage}`)).toEqual(['1φ2W:105', '1φ3W:105/210', '3φ3W:440']);
  });
  it('既定の電圧を「空欄」にすると、電気方式も電圧も空欄（書いてある行はそのとおり）', () => {
    const r = parsePastedCircuits('1\t予備\n2\t動力\t\t\t3φ3W\n3\tB\t\t\t\t105', { voltage: '' });
    expect(r.errors).toEqual([]);
    expect(r.circuits.map((c) => `${c.system}:${c.useVoltage}`)).toEqual([':0', '3φ3W:210', '1φ2W:105']);
  });
  it('名称だけの貼り付けは番号を自動で振り、既定の電圧を使う', () => {
    const r = parsePastedCircuits('照明 1F\nコンセント\n', { voltage: '105/210' });
    expect(r.circuits.map((c) => `${c.no}${c.name}:${c.system}:${c.voltageLabel}`)).toEqual(['1照明 1F:1φ3W:105/210', '2コンセント:1φ3W:105/210']);
  });
  it('2つ以上の空白区切りも使える（名称の中の1つの空白は区切りにしない）', () => {
    const r = parsePastedCircuits('1  照明 1F  ELB  20  1φ3W  105/210', d);
    expect(r.circuits[0]).toMatchObject({ no: '1', name: '照明 1F', deviceType: 'ELB', breakerA: 20, system: '1φ3W', useVoltage: 210, voltageLabel: '105/210' });
  });
  it('3φ4W は使えない。電気方式と電圧を両方書いた行は、組み合わせが合わなくても書いたとおりに取り込む', () => {
    const r = parsePastedCircuits('1\tA\t\t\t3φ4W\t440\n2\tB\t\t\t1φ3W\t440\n3\tC\t\t\t3φ3W\t105\n4\tD\t\t\t3φ3W\t210', d);
    expect(r.circuits.map((c) => `${c.no}:${c.system}:${c.useVoltage}`)).toEqual(['2:1φ3W:440', '3:3φ3W:105', '4:3φ3W:210']);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.reason).toContain('使えません');
  });
  it('電圧は自由に書ける（4パターン以外も、書いたとおり）。電気方式は書かれていればそのまま、無ければ空欄', () => {
    const r = parsePastedCircuits('1\tA\t\t\t\t200V\n2\tB\t\t\t\t100/200\n3\tC\t\t\t1φ3W\t１００／２００V\n4\tD\t\t\t\t210', d);
    expect(r.errors).toEqual([]);
    expect(r.circuits.map((c) => `${c.system || '空欄'}:${c.useVoltage}:${c.voltageLabel ?? '-'}`)).toEqual([
      '空欄:200:-', // 数字だけなら表記は持たない（帳票には 200）
      '空欄:200:100/200', // 判定には大きい方、帳票には書いたとおり
      '1φ3W:200:100/200',
      '3φ3W:210:-', // 4パターンのどれかなら、電気方式が決まる
    ]);
  });
  it('高圧・数値でない値・容量の誤りは理由つきで弾き、他の行は取り込む', () => {
    const r = parsePastedCircuits('1\t高圧受電\t\t\t\t6600\n2\tB\t\t\t\tabc\n3\tC\t\t-5\t\t210\n4\tD\t\t\t\t200\n5\tE', d);
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3]);
    expect(r.errors[0]!.reason).toContain('低圧');
    expect(r.errors[1]!.reason).toContain('数値ではありません');
    expect(r.errors[2]!.reason).toContain('容量');
    expect(r.circuits.map((c) => c.no)).toEqual(['4', '5']);
  });
});
