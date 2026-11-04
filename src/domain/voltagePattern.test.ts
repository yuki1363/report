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

import { allowedTogether, applySystem, applyVoltagePattern, patternForSystem, patternsOfSystem, SYSTEM_OF_PATTERN } from './voltagePattern.ts';

const base = { system: '1φ3W' as const, useVoltage: 210, voltageLabel: '105/210', groundVoltage: 105 };

describe('電圧と電気方式の連動', () => {
  it('電気方式ごとに選べる電圧（3φ3W は 210 と 440 の両方）', () => {
    expect(patternsOfSystem('1φ2W').map((p) => p.value)).toEqual(['105']);
    expect(patternsOfSystem('1φ3W').map((p) => p.value)).toEqual(['105/210']);
    expect(patternsOfSystem('3φ3W').map((p) => p.value)).toEqual(['210', '440']);
    expect(Object.keys(SYSTEM_OF_PATTERN).sort()).toEqual(['105', '105/210', '210', '440'].sort());
    expect(allowedTogether('3φ3W', patternFor('440')!)).toBe(true);
    expect(allowedTogether('1φ3W', patternFor('440')!)).toBe(false);
  });
  it('電圧を選ぶと電気方式が決まり、対地電圧・表記も更新される', () => {
    expect(applyVoltagePattern(base, patternFor('105')!)).toEqual({ system: '1φ2W', useVoltage: 105, groundVoltage: 105 });
    expect(applyVoltagePattern(base, patternFor('440')!)).toEqual({ system: '3φ3W', useVoltage: 440, groundVoltage: 440 });
    expect(applyVoltagePattern({ system: '3φ3W', useVoltage: 440, groundVoltage: 440 }, patternFor('105/210')!)).toEqual(base);
  });
  it('電気方式を選ぶと、電圧が合わなければ既定に、合えば残す（3φ3W の 440 は残る）', () => {
    expect(applySystem(base, '3φ3W')).toMatchObject({ system: '3φ3W', useVoltage: 210, groundVoltage: 210 });
    expect(applySystem({ system: '3φ3W', useVoltage: 440, groundVoltage: 440 }, '3φ3W')).toMatchObject({ useVoltage: 440 });
    expect(applySystem({ system: '3φ3W', useVoltage: 440, groundVoltage: 440 }, '1φ2W')).toEqual({ system: '1φ2W', useVoltage: 105, groundVoltage: 105 });
    expect(applySystem({ system: '3φ3W', useVoltage: 210, groundVoltage: 210 }, '1φ3W')).toEqual(base);
    expect(patternForSystem('3φ3W', patternFor('105')!).value).toBe('210');
  });
});
