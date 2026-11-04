/**
 * 絶縁抵抗の判定（電気設備技術基準 第58条）。純粋関数のみ。
 *
 * | 区分                                         | 基準値        |
 * |----------------------------------------------|---------------|
 * | 使用電圧 300V 以下、かつ対地電圧 150V 以下   | 0.1 MΩ 以上   |
 * | 使用電圧 300V 以下で、上記以外               | 0.2 MΩ 以上   |
 * | 使用電圧 300V 超                             | 0.4 MΩ 以上   |
 */
import {
  DEFAULT_CRITERIA,
  READING_KEYS,
  type Circuit,
  type Criteria,
  type Reading,
} from '../shared/schema.ts';

export type Verdict = 'good' | 'bad' | 'none';

export const VERDICT_LABEL: Record<Verdict, string> = {
  good: '良',
  bad: '否',
  none: '未判定',
};

export interface CriterionResult {
  /** 基準値 [MΩ] */
  mohm: number;
  /** 区分の説明 */
  label: string;
}

/** 使用電圧・対地電圧から基準値を求める。 */
export function criterionFor(
  useVoltage: number,
  groundVoltage: number,
  criteria: Criteria = DEFAULT_CRITERIA,
): CriterionResult {
  if (useVoltage > criteria.useVoltageLimit) {
    return { mohm: criteria.highMohm, label: `使用電圧${criteria.useVoltageLimit}V超` };
  }
  if (groundVoltage <= criteria.groundVoltageLimit) {
    return {
      mohm: criteria.lowGroundMohm,
      label: `${criteria.useVoltageLimit}V以下・対地${criteria.groundVoltageLimit}V以下`,
    };
  }
  return { mohm: criteria.lowOtherMohm, label: `${criteria.useVoltageLimit}V以下・その他` };
}

export interface CircuitJudgment {
  verdict: Verdict;
  /** 判定に使った最小値（測定値が無い場合は undefined） */
  min?: Reading & { kind: 'value' | 'over' };
  criterion: CriterionResult;
}

/** 判定対象となる測定値（value / over）だけを取り出す。na と未入力は除外。 */
export function measuredReadings(circuit: Pick<Circuit, 'readings'>): (Reading & { kind: 'value' | 'over' })[] {
  const out: (Reading & { kind: 'value' | 'over' })[] = [];
  for (const k of READING_KEYS) {
    const r = circuit.readings[k];
    if (r && (r.kind === 'value' || r.kind === 'over')) out.push(r);
  }
  return out;
}

/** 回路の判定。測定値の最小値で判定し、測定値が1つも無ければ「未判定」。 */
export function judgeCircuit(
  circuit: Pick<Circuit, 'readings' | 'useVoltage' | 'groundVoltage'>,
  criteria: Criteria = DEFAULT_CRITERIA,
): CircuitJudgment {
  const criterion = criterionFor(circuit.useVoltage, circuit.groundVoltage, criteria);
  const readings = measuredReadings(circuit);
  if (readings.length === 0) return { verdict: 'none', criterion };
  let min = readings[0]!;
  for (const r of readings) {
    // 同値なら 'value'（実測値）を優先して表示する
    if (r.mohm < min.mohm || (r.mohm === min.mohm && r.kind === 'value')) min = r;
  }
  // 境界値は「以上」なので合格（例: 0.4 MΩ → 良）
  const verdict: Verdict = min.mohm >= criterion.mohm ? 'good' : 'bad';
  return { verdict, min, criterion };
}

/**
 * 盤全体の判定。
 * - 1回路でも「否」があれば「否」
 * - 「否」が無く、全回路が「良」なら「良」
 * - 「否」が無く、未判定の回路を含む場合は「未判定」（安全側。確認事項として要確認）
 * - 回路が0件なら「未判定」
 */
export function judgePanel(
  circuits: Pick<Circuit, 'readings' | 'useVoltage' | 'groundVoltage'>[],
  criteria: Criteria = DEFAULT_CRITERIA,
): Verdict {
  if (circuits.length === 0) return 'none';
  const verdicts = circuits.map((c) => judgeCircuit(c, criteria).verdict);
  if (verdicts.includes('bad')) return 'bad';
  if (verdicts.every((v) => v === 'good')) return 'good';
  return 'none';
}
