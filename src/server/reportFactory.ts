import { randomUUID } from 'node:crypto';
import type { Report } from '../shared/schema.ts';

export function todayLocal(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function newReport(): Report {
  return {
    id: randomUUID(),
    templateId: 'default',
    panel: { name: '' },
    date: todayLocal(),
    inspector: '',
    instrument: { model: '' },
    circuits: [],
    sourceFiles: [],
  };
}

/**
 * 既存の報告書から新規作成する。
 * - copy:    すべて複製（測定値も含む）。測定日は今日にする。
 * - inherit: 前回値の引き継ぎ。盤・回路構成・測定器・測定者・書式を引き継ぎ、測定値・温湿度は空にする。
 */
export function deriveReport(src: Report, mode: 'copy' | 'inherit'): Report {
  const base = structuredClone(src);
  base.id = randomUUID();
  base.date = todayLocal();
  base.circuits = base.circuits.map((c) => ({ ...c, id: randomUUID(), readings: mode === 'copy' ? c.readings : {} }));
  if (mode === 'inherit') {
    delete base.tempC;
    delete base.humidity;
    delete base.note;
  }
  return base;
}
