/**
 * 電気方式と使用電圧から対地電圧を自動算出する（手動で上書き可能）。
 *
 * 算出ルール（一般的な接地方式を前提にした既定値。現場の接地方式により異なるため、
 * 画面で手動上書きできるようにしている）:
 * - 1φ2W: 使用電圧そのもの（片側接地を想定。100V → 100V、200V → 200V）
 * - 1φ3W: 使用電圧 ÷ 2（中性線接地。100/200V → 100V）
 * - 3φ3W: 使用電圧そのもの（Δ結線の1相接地を想定。200V → 200V）
 * - 3φ4W: 使用電圧 ÷ √3（Y結線の中性点接地。400V → 231V）
 */
import type { WiringSystem } from '../shared/schema.ts';

export function autoGroundVoltage(system: WiringSystem, useVoltage: number): number {
  switch (system) {
    case '1φ2W':
      return useVoltage;
    case '1φ3W':
      return Math.round(useVoltage / 2);
    case '3φ3W':
      return useVoltage;
    case '3φ4W':
      return Math.round(useVoltage / Math.sqrt(3));
  }
}

/** 電気方式ごとの既定の使用電圧 [V] */
export const DEFAULT_USE_VOLTAGE: Record<WiringSystem, number> = {
  '1φ2W': 105,
  '1φ3W': 210,
  '3φ3W': 210,
  '3φ4W': 440,
};
