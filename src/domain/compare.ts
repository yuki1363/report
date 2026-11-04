/** P4: 前回値との比較（純粋関数）。 */
import type { Circuit, Reading, Report } from '../shared/schema.ts';
import { judgeCircuit } from './judgment.ts';

/** 前回より大きく下がったと判断する比率（今回最小値 / 前回最小値 がこれ未満）。要確認事項: 社内基準があれば合わせる。 */
export const DROP_RATIO = 0.5;

export interface CircuitComparison {
  circuitId: string;
  prevMin?: Reading & { kind: 'value' | 'over' };
  /** 今回最小値 / 前回最小値。どちらかが無い、または上限超過どうしの場合は undefined */
  ratio?: number;
  dropped: boolean;
}

export interface PreviousComparison {
  previous?: { id: string; date: string };
  circuits: CircuitComparison[];
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** 同じ盤名で、測定日が今回より前の報告書のうち最新のものを返す。 */
export function findPrevious(report: Report, all: Report[]): Report | undefined {
  const name = norm(report.panel.name);
  if (!name) return undefined;
  return all
    .filter((r) => r.id !== report.id && norm(r.panel.name) === name && r.date < report.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
}

/** 回路の対応付け: 回路No と回路名称が一致 → 回路No だけ一致（一意な場合） */
function matchCircuit(c: Circuit, prev: Circuit[]): Circuit | undefined {
  const exact = prev.find((p) => norm(p.no) === norm(c.no) && norm(p.name) === norm(c.name));
  if (exact) return exact;
  const byNo = prev.filter((p) => norm(p.no) === norm(c.no));
  return byNo.length === 1 ? byNo[0] : undefined;
}

export function comparePrevious(report: Report, all: Report[]): PreviousComparison {
  const prev = findPrevious(report, all);
  if (!prev) return { circuits: report.circuits.map((c) => ({ circuitId: c.id, dropped: false })) };
  return {
    previous: { id: prev.id, date: prev.date },
    circuits: report.circuits.map((c) => {
      const p = matchCircuit(c, prev.circuits);
      const prevMin = p ? judgeCircuit(p).min : undefined;
      const curMin = judgeCircuit(c).min;
      let ratio: number | undefined;
      if (prevMin && curMin && prevMin.mohm > 0 && !(prevMin.kind === 'over' && curMin.kind === 'over')) {
        ratio = curMin.mohm / prevMin.mohm;
      }
      return { circuitId: c.id, ...(prevMin ? { prevMin } : {}), ...(ratio !== undefined ? { ratio } : {}), dropped: ratio !== undefined && ratio < DROP_RATIO };
    }),
  };
}
