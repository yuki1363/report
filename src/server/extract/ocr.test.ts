import { describe, expect, it } from 'vitest';
import { normalizeSystem, parseOcrText, textLayerToLines } from './ocr.ts';

describe('OCR 結果の解析', () => {
  it.each([
    ['1Φ3W', '1φ3W'],
    ['3φ3W', '3φ3W'],
    ['１Ｐ２Ｗ', '1φ2W'],
    ['3P4W', '3φ4W'],
    ['単相3線', '1φ3W'],
    ['三相三線', '3φ3W'],
    ['2φ3W', null],
    ['1の3W', '1φ3W'], // OCR の誤認
    ['192W', '1φ2W'],
  ])('%s → %s', (s, v) => expect(normalizeSystem(s)).toBe(v));

  it('実際の OCR 出力（表の罫線を含む）', () => {
    const r = parseOcrText(['電灯盤 L-1 単線結線図\n設置場所 ・ 本館 1F 電気室\nNo 回路名称 電気方式 電圧 ブレーカ\n1 照明 1F 東 1の3W 100/200V | 20AT\n2 | コンセント 1F | 192W 100V 20AT']);
    expect(r.panel).toEqual({ name: '電灯盤 L-1', location: '本館 1F 電気室' });
    expect(r.circuits).toEqual([
      { no: '1', name: '照明 1F 東', system: '1φ3W', useVoltage: 200, breakerA: 20 },
      { no: '2', name: 'コンセント 1F', system: '1φ2W', useVoltage: 100, breakerA: 20 },
    ]);
  });

  it('盤名と回路を拾い、すべて uncertain にする', () => {
    const r = parseOcrText(['電灯盤 L-1\n1 照明 1F 1φ3W 100/200V 20AT\n2. コンセント 1Φ2W 100V 20A\nその他の行\n3 予備']);
    expect(r.panel.name).toBe('電灯盤 L-1');
    expect(r.circuits).toEqual([
      { no: '1', name: '照明 1F', system: '1φ3W', useVoltage: 200, breakerA: 20 },
      { no: '2', name: 'コンセント', system: '1φ2W', useVoltage: 100, breakerA: 20 },
      { no: '3', name: '予備', system: null, useVoltage: null, breakerA: null },
    ]);
    expect(r.uncertain.filter((u) => u.field.startsWith('circuits.')).length).toBe(15);
    expect(r.uncertain.find((u) => u.field === 'circuits.2.system')!.reason).toBe('読み取れませんでした');
  });
});

describe('テキスト層からの行の復元', () => {
  it('同じ高さの文字を左から順にまとめる', () => {
    const layer = ['300,103: 1φ3W', '20,100: 1', '60,101: 照明', '20,150: 2', '60,152: コンセント', '10,20: 電灯盤 L-1'].join('\n');
    expect(textLayerToLines(layer)).toBe('電灯盤 L-1\n1 照明 1φ3W\n2 コンセント');
  });
});
