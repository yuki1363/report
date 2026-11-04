import { describe, expect, it } from 'vitest';
import { autoGroundVoltage, DEFAULT_USE_VOLTAGE } from './groundVoltage.ts';
import { judgeCircuit } from './judgment.ts';
import { patternFor, patternOf, patternOfText, VOLTAGE_PATTERNS } from './voltagePattern.ts';

describe('電圧パターン 105 / 105/210 / 210 / 440', () => {
  it('選択肢は4つ。105/210 は使用電圧 210V で表記を残す', () => {
    expect(VOLTAGE_PATTERNS.map((p) => p.value)).toEqual(['105', '105/210', '210', '440']);
    expect(patternFor('105/210')).toMatchObject({ useVoltage: 210, label: '105/210' });
    expect(patternFor('210')!.label).toBeUndefined();
  });
  it('回路の電圧から、どのパターンかを判別（表記の有無で 210 と 105/210 を区別）', () => {
    expect(patternOf(210, '105/210')!.value).toBe('105/210');
    expect(patternOf(210)!.value).toBe('210');
    expect(patternOf(440)!.value).toBe('440');
    expect(patternOf(200)).toBeUndefined();
  });
  it('文字から判別（全角・V つき可）', () => {
    expect(patternOfText('１０５／２１０V')!.value).toBe('105/210');
    expect(patternOfText('440V')!.value).toBe('440');
    expect(patternOfText('100/200')).toBeUndefined();
    expect(patternOfText('')).toBeUndefined();
  });
  it('各パターンの判定基準（電気方式ごとの対地電圧から）', () => {
    const crit = (sys: Parameters<typeof autoGroundVoltage>[0], v: number) => judgeCircuit({ useVoltage: v, groundVoltage: autoGroundVoltage(sys, v), readings: {} }).criterion.mohm;
    expect(crit('1φ2W', 105)).toBe(0.1); // 105V 単相2線
    expect(crit('1φ3W', 210)).toBe(0.1); // 105/210V 単相3線（対地 105V）
    expect(crit('3φ3W', 210)).toBe(0.2); // 210V 三相3線（対地 210V）
    expect(crit('3φ3W', 440)).toBe(0.4); // 440V（300V 超）
  });
  it('電気方式ごとの既定の電圧', () => {
    expect(DEFAULT_USE_VOLTAGE).toEqual({ '1φ2W': 105, '1φ3W': 210, '3φ3W': 210, '3φ4W': 440 });
  });
});
