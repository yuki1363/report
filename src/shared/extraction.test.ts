import { describe, expect, it } from 'vitest';
import { ExtractionSchema, mergeExtractions, type Extraction } from './extraction.ts';

// 実際の負荷表（1枚に盤が複数、電気方式・電圧が表の端に1回だけ書かれる）を読み取った結果の例
const sample: Extraction = {
  panels: [
    {
      name: '低圧動力盤 No.4',
      location: null,
      circuits: [
        { no: '41', name: '1FP-2-1, 1FP-2-2, 1FP-2-3', system: '3φ3W', useVoltage: 210, breakerA: 350 },
        { no: '43', name: '溶接機', system: '3φ3W', useVoltage: 210, breakerA: 225 },
        { no: '47', name: 'スペース', system: '3φ3W', useVoltage: 210, breakerA: null },
      ],
    },
    { name: '低圧動力盤 No.3', location: null, circuits: [{ no: '31', name: null, system: '3φ3W', useVoltage: 210, breakerA: 350 }] },
  ],
  uncertain: [],
};

describe('読み取り結果のまとめ', () => {
  it('形式の検証', () => {
    expect(ExtractionSchema.safeParse(sample).success).toBe(true);
    expect(ExtractionSchema.safeParse({ panel: {}, circuits: [] }).success).toBe(false);
  });
  it('null の項目は要確認に自動で載る（盤の番号つき）', () => {
    const m = mergeExtractions([sample]);
    expect(m.uncertain.map((u) => u.field).sort()).toEqual(['panels.1.circuits.0.name']);
  });
  it('ページ分割の結果をまとめると盤の番号がずれる', () => {
    const second: Extraction = {
      panels: [{ name: '盤B', location: null, circuits: [{ no: '1', name: 'x', system: '1φ2W', useVoltage: 100, breakerA: null }] }],
      uncertain: [{ field: 'panels.0.circuits.0.breakerA', reason: 'AT 不明' }],
    };
    const m = mergeExtractions([sample, second]);
    expect(m.panels.map((p) => p.name)).toEqual(['低圧動力盤 No.4', '低圧動力盤 No.3', '盤B']);
    expect(m.uncertain).toContainEqual({ field: 'panels.2.circuits.0.breakerA', reason: 'AT 不明' });
  });
});
