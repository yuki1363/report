/** 確認・修正画面で確定した内容を報告書に反映する（純粋関数）。 */
import type { ConfirmBody } from '../shared/extraction.ts';
import type { Circuit, Report } from '../shared/schema.ts';
import { autoGroundVoltage } from './groundVoltage.ts';

/**
 * 測定電圧の既定値（画面で変更可能）。
 * 使用電圧 300V 以下 → 250V、300V 超 → 500V。（社内の測定基準があれば合わせる。要確認事項）
 */
export function defaultTestVoltage(useVoltage: number): Circuit['testVoltage'] {
  return useVoltage > 300 ? 500 : 250;
}

export function confirmedCircuits(body: ConfirmBody, source: Circuit['source'], newId: () => string): Circuit[] {
  return body.circuits.map((c) => ({
    id: newId(),
    no: c.no,
    name: c.name,
    system: c.system,
    useVoltage: c.useVoltage,
    groundVoltage: autoGroundVoltage(c.system, c.useVoltage),
    testVoltage: defaultTestVoltage(c.useVoltage),
    ...(c.breakerA !== undefined ? { breakerA: c.breakerA } : {}),
    readings: {},
    source,
  }));
}

/** 既存（または新規）の報告書へ反映した結果を返す。 */
export function applyConfirmation(
  report: Report,
  body: ConfirmBody,
  source: Circuit['source'],
  sourceFiles: string[],
  newId: () => string,
): Report {
  const circuits = confirmedCircuits(body, source, newId);
  const next: Report = {
    ...report,
    circuits: body.mode === 'append' ? [...report.circuits, ...circuits] : circuits,
    sourceFiles: [...new Set([...report.sourceFiles, ...sourceFiles])],
  };
  if (body.mode === 'new' || body.applyPanel) {
    next.panel = { name: body.panel.name, ...(body.panel.location ? { location: body.panel.location } : {}) };
  }
  return next;
}
