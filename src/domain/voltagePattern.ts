import type { Circuit, WiringSystem } from '../shared/schema.ts';
import { autoGroundVoltage } from './groundVoltage.ts';
import { normalizeVoltageText, parseVoltage } from './system.ts';

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
  return withPattern(c, SYSTEM_OF_PATTERN[pat.value] ?? (c.system || '3φ3W'), pat);
}

/** 電気方式を空欄にしたとき: 使用電圧・対地電圧・表記も空欄（0）にする */
export function applyBlank<T extends VoltageFields>(c: T): T {
  const { voltageLabel: _l, ...rest } = c;
  return { ...rest, system: '', useVoltage: 0, groundVoltage: 0 } as T;
}

/** 電気方式を選んだとき: 電圧が合わなければ、その方式の既定の電圧にする。空欄（''）なら電圧も空欄 */
export function applySystem<T extends VoltageFields>(c: T, system: WiringSystem | ''): T {
  if (system === '') return applyBlank(c);
  const cur = patternOf(c.useVoltage, c.voltageLabel);
  // 自由に書かれた電圧（4パターン以外）は、方式を変えても書いたまま残す
  if (!cur && (c.useVoltage > 0 || c.voltageLabel)) {
    return { ...c, system, groundVoltage: c.useVoltage > 0 ? autoGroundVoltage(system, c.useVoltage) : 0 };
  }
  return withPattern(c, system, patternForSystem(system, cur));
}

/**
 * 電圧を入力欄に書いたとき（または候補から選んだとき）。
 * - 書いただけ（linkSystem=false）: **電気方式は変えない**。書いたとおりに帳票へ出す（候補と同じ数字でも）。
 *   数字として読めれば（「100/200」は大きい方）判定に使う。読めなければ使用電圧は 0（判定しない）。空欄なら電圧だけが空欄
 * - 候補から選んだ（linkSystem=true）: 4パターンなら電気方式も連動して決まる
 */
export function applyFreeVoltage<T extends VoltageFields>(c: T, text: string, linkSystem = false): T {
  const t = normalizeVoltageText(text);
  const pat = patternOfText(t);
  if (linkSystem && pat) return applyVoltagePattern(c, pat);
  const { voltageLabel: _l, ...rest } = c;
  if (t === '') return { ...rest, useVoltage: 0, groundVoltage: 0 } as T; // 電圧だけ空欄（電気方式はそのまま）
  const v = pat ? pat.useVoltage : parseVoltage(t);
  const use = v !== undefined && Number.isFinite(v) && v > 0 ? v : 0;
  const label = pat ? pat.label : use > 0 && String(use) === t ? undefined : t; // 数字だけなら表記は持たない
  return {
    ...rest,
    ...(label ? { voltageLabel: label } : {}),
    useVoltage: use,
    groundVoltage: c.system && use > 0 ? autoGroundVoltage(c.system, use) : 0,
  } as T;
}

/** 入力欄に出す電圧の文字（書いた表記があればそれ、なければ数値。空欄なら空） */
export const voltageText = (c: { useVoltage: number; voltageLabel?: string }): string => c.voltageLabel ?? (c.useVoltage > 0 ? String(c.useVoltage) : '');

// ---------------------------------------------------------------------------
// 以前のデータの電圧を、新しい4パターンに直す
// ---------------------------------------------------------------------------

/**
 * 以前の版で入力された電圧（100 / 200 / 400 など、表記なし）を、新しいパターンに直す。
 * 直し方が決まるものだけ直し、それ以外（例: 1φ2W の 200V）は変えない。
 *   1φ2W: 100〜110 → 105 ／ 1φ3W: 200〜210 → 105/210 ／ 3φ3W: 200〜210 → 210、400〜440 → 440
 *   3φ4W（使わなくなった方式）は 3φ3W として、同じ規則で直す
 * 何度かけても結果は同じ（冪等）。
 */
export function normalizeLegacyVoltage<T extends VoltageFields>(c: T): T {
  if (c.system === '') return c; // 空欄は直さない
  const system: WiringSystem = c.system === '3φ4W' ? '3φ3W' : c.system;
  const v = c.useVoltage;
  let pat: VoltagePattern | undefined;
  if (system === '1φ2W' && v >= 100 && v <= 110) pat = patternFor('105');
  else if (system === '1φ3W' && v >= 200 && v <= 210) pat = patternFor('105/210');
  else if (system === '3φ3W' && v >= 200 && v <= 210) pat = patternFor('210');
  else if (system === '3φ3W' && v >= 400 && v <= 440) pat = patternFor('440');
  if (!pat) return c;
  // すでに新しいパターンで、方式とも合っていれば変えない
  const cur = patternOf(c.useVoltage, c.voltageLabel);
  if (cur && cur.value === pat.value && c.system === system) return c;
  return withPattern(c, system, pat);
}
