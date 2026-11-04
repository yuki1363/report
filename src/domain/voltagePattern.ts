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
