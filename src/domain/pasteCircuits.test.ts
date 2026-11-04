import { describe, expect, it } from 'vitest';
import { parsePastedCircuits } from './pasteCircuits.ts';

const d = { voltage: '210' };
const brief = (r: ReturnType<typeof parsePastedCircuits>) => r.circuits.map((c) => `${c.name}|${c.deviceType ?? ''}|${c.breakerA ?? ''}|${c.system}|${c.voltageLabel ?? c.useVoltage}`);

describe('回路の貼り付け（回路名称 / 種別 / 容量 / 電気方式 / 使用電圧。回路No は使わない）', () => {
  it('Excel からのコピー。見出し行は読み飛ばし、空欄は既定の電圧（210 → 3φ3W）', () => {
    const text = '負荷名称\t種別\t容量\t電気方式\t電圧\n1FP-2-1, 1FP-2-2\tELB\t350\n溶接機\tMg\t225\t3Φ3W\t440\nスペース\n';
    const r = parsePastedCircuits(text, d);
    expect(r.skippedHeader).toBe(true);
    expect(r.errors).toEqual([]);
    expect(brief(r)).toEqual(['1FP-2-1, 1FP-2-2|ELB|350|3φ3W|210', '溶接機|Mg|225|3φ3W|440', 'スペース|||3φ3W|210']);
    expect(r.circuits.every((c) => c.no === '')).toBe(true);
  });
  it('先頭に回路No の列（数字だけ）があっても読み飛ばす。数字だけの行は読み飛ばす', () => {
    const r = parsePastedCircuits('ELB No.\t負荷名称\t種別\t容量\n41\t動力A\tELB\t350\n42\t動力B\tMCB\t225\n43\n44-1\n動力C\n', d);
    expect(r.errors).toEqual([]);
    expect(brief(r)).toEqual(['動力A|ELB|350|3φ3W|210', '動力B|MCB|225|3φ3W|210', '動力C|||3φ3W|210']);
  });
  it('電圧だけ書けば電気方式が決まる（105 → 1φ2W、105/210 → 1φ3W、440 → 3φ3W）', () => {
    const r = parsePastedCircuits('A\t\t\t\t105\nB\t\t\t\t105/210\nC\t\t\t\t440V\nD\t\t\t\t１０５／２１０', d);
    expect(brief(r)).toEqual(['A|||1φ2W|105', 'B|||1φ3W|105/210', 'C|||3φ3W|440', 'D|||1φ3W|105/210']);
  });
  it('電気方式だけ書けば電圧が決まる。3φ3W は既定の電圧（440 など）が合えばそれを使う', () => {
    const r = parsePastedCircuits('A\t\t\t1φ2W\nB\t\t\t1ファイ3\nC\t\t\t3φ3W', { voltage: '440' });
    expect(brief(r)).toEqual(['A|||1φ2W|105', 'B|||1φ3W|105/210', 'C|||3φ3W|440']);
  });
  it('既定の電圧を「空欄」にすると、電気方式も電圧も空欄（書いてある行はそのとおり）', () => {
    const r = parsePastedCircuits('予備\n動力\t\t\t3φ3W\nB\t\t\t\t105', { voltage: '' });
    expect(r.errors).toEqual([]);
    expect(r.circuits.map((c) => `${c.name}:${c.system}:${c.useVoltage}`)).toEqual(['予備::0', '動力:3φ3W:210', 'B:1φ2W:105']);
  });
  it('名称だけの貼り付けは、既定の電圧を使う', () => {
    const r = parsePastedCircuits('照明 1F\nコンセント\n', { voltage: '105/210' });
    expect(brief(r)).toEqual(['照明 1F|||1φ3W|105/210', 'コンセント|||1φ3W|105/210']);
  });
  it('2つ以上の空白区切りも使える（名称の中の1つの空白は区切りにしない）', () => {
    const r = parsePastedCircuits('照明 1F  ELB  20  1φ3W  105/210', d);
    expect(r.circuits[0]).toMatchObject({ name: '照明 1F', deviceType: 'ELB', breakerA: 20, system: '1φ3W', useVoltage: 210, voltageLabel: '105/210' });
  });
  it('3φ4W は使えない。電気方式と電圧を両方書いた行は、組み合わせが合わなくても書いたとおりに取り込む', () => {
    const r = parsePastedCircuits('A\t\t\t3φ4W\t440\nB\t\t\t1φ3W\t440\nC\t\t\t3φ3W\t105\nD\t\t\t3φ3W\t210', d);
    expect(r.circuits.map((c) => `${c.name}:${c.system}:${c.useVoltage}`)).toEqual(['B:1φ3W:440', 'C:3φ3W:105', 'D:3φ3W:210']);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.reason).toContain('使えません');
  });
  it('電圧は自由に書ける（4パターン以外も、書いたとおり）。電気方式は書かれていればそのまま、無ければ空欄', () => {
    const r = parsePastedCircuits('A\t\t\t\t200V\nB\t\t\t\t100/200\nC\t\t\t1φ3W\t１００／２００V\nD\t\t\t\t210', d);
    expect(r.errors).toEqual([]);
    expect(r.circuits.map((c) => `${c.system || '空欄'}:${c.useVoltage}:${c.voltageLabel ?? '-'}`)).toEqual([
      '空欄:200:-',
      '空欄:200:100/200',
      '1φ3W:200:100/200',
      '3φ3W:210:-',
    ]);
  });
  it('高圧・数値でない値・容量の誤りは理由つきで弾き、他の行は取り込む', () => {
    const r = parsePastedCircuits('高圧受電\t\t\t\t6600\nB\t\t\t\tabc\nC\t\t-5\t\t210\nD\t\t\t\t200\nE', d);
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3]);
    expect(r.errors[0]!.reason).toContain('低圧');
    expect(r.errors[1]!.reason).toContain('数値ではありません');
    expect(r.errors[2]!.reason).toContain('容量');
    expect(r.circuits.map((c) => c.name)).toEqual(['D', 'E']);
  });
});
