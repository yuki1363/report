import type { Circuit, WiringSystem } from '../shared/schema.ts';
import { autoGroundVoltage } from './groundVoltage.ts';

/**
 * 使用電圧のパターン（選択肢）: 105 / 105/210 / 210 / 440
 * 「105/210」は単相3線の表記で、使用電圧は大きい方の 210V、帳票には「105/210」と出す。
 */
export interface VoltagePattern {
  /** 選択肢の表示（兼 帳票に出す表記） */
  value: string;
  /** 使用電圧 [V]（判定に使う） */
  useVoltage: number;
  /** 帳票に出す表記が数値と違うときだけ持つ */
  label?: string;
}

export const VOLTAGE_PATTERNS: readonly VoltagePattern[] = [
  { value: '105', useVoltage: 105 },
  { value: '105/210', useVoltage: 210, label: '105/210' },
  { value: '210', useVoltage: 210 },
  { value: '440', useVoltage: 440 },
];

export const VOLTAGE_PATTERN_TEXT = VOLTAGE_PATTERNS.map((p) => p.value).join(' / ');

/** 回路の電圧がどのパターンか（どれでもなければ undefined） */
export function patternOf(useVoltage: number, label?: string): VoltagePattern | undefined {
  return VOLTAGE_PATTERNS.find((p) => (p.label ?? '') === (label ?? '') && p.useVoltage === useVoltage);
}

/** 文字（「105/210」「210V」など）が、どのパターンか */
export function patternOfText(text: string): VoltagePattern | undefined {
  const t = text.normalize('NFKC').replace(/[,\s]/g, '').replace(/(V|ボルト)$/i, '');
  return VOLTAGE_PATTERNS.find((p) => p.value === t);
}

export const patternFor = (value: string): VoltagePattern | undefined => VOLTAGE_PATTERNS.find((p) => p.value === value);

// ---------------------------------------------------------------------------
// 電気方式との連動
//   1φ2W → 105 ／ 1φ3W → 105/210 ／ 3φ3W → 210 または 440（どちらも選べる）
// ---------------------------------------------------------------------------

/** 電圧パターンから決まる電気方式 */
export const SYSTEM_OF_PATTERN: Record<string, WiringSystem> = {
  '105': '1φ2W',
  '105/210': '1φ3W',
  '210': '3φ3W',
  '440': '3φ3W',
};

/** 電気方式ごとに選べる電圧パターン（先頭が既定） */
export function patternsOfSystem(system: WiringSystem): VoltagePattern[] {
  return VOLTAGE_PATTERNS.filter((p) => SYSTEM_OF_PATTERN[p.value] === system);
}

/** その電気方式で、その電圧パターンを選べるか */
export const allowedTogether = (system: WiringSystem, pattern: VoltagePattern): boolean => SYSTEM_OF_PATTERN[pattern.value] === system;

/** 電気方式に合う電圧パターン。いまの電圧が合っていればそれを残し、合わなければ既定（先頭）にする */
export function patternForSystem(system: WiringSystem, current?: VoltagePattern): VoltagePattern {
  const list = patternsOfSystem(system);
  return (current && list.find((p) => p.value === current.value)) || list[0] || VOLTAGE_PATTERNS[2]!;
}

type VoltageFields = Pick<Circuit, 'system' | 'useVoltage' | 'groundVoltage'> & { voltageLabel?: string };

function withPattern<T extends VoltageFields>(c: T, system: WiringSystem, pat: VoltagePattern): T {
  const { voltageLabel: _l, ...rest } = c;
  return {
    ...rest,
    system,
    useVoltage: pat.useVoltage,
    ...(pat.label ? { voltageLabel: pat.label } : {}),
    groundVoltage: autoGroundVoltage(system, pat.useVoltage),
  } as T;
}

/** 電圧を選んだとき: 電気方式も自動で決まる */
export function applyVoltagePattern<T extends VoltageFields>(c: T, pat: VoltagePattern): T {
  return withPattern(c, SYSTEM_OF_PATTERN[pat.value] ?? c.system, pat);
}

/** 電気方式を選んだとき: 電圧が合わなければ、その方式の既定の電圧にする */
export function applySystem<T extends VoltageFields>(c: T, system: WiringSystem): T {
  return withPattern(c, system, patternForSystem(system, patternOf(c.useVoltage, c.voltageLabel)));
}
