import type { Report } from '../shared/schema.ts';

/** テンプレート編集時のプレビュー用データ */
export const SAMPLE_REPORT: Report = {
  id: 'sample',
  templateId: 'default',
  panel: { name: '電灯盤 L-1（見本）', location: '本館 1F 電気室' },
  date: '2026-11-04',
  inspector: '髙橋 太郎',
  tempC: 22,
  humidity: 55,
  instrument: { model: '絶縁抵抗計 MΩ-500', serial: 'SN-0001', calDate: '2026-04-01' },
  circuits: [
    { id: 's1', no: '1', name: '照明 1F', system: '1φ3W', useVoltage: 200, groundVoltage: 100, testVoltage: 250, breakerA: 20, readings: { RE: { kind: 'value', mohm: 120 }, SE: { kind: 'na' }, ALL_E: { kind: 'over', mohm: 2000 } }, source: 'manual' },
    { id: 's2', no: '2', name: 'コンセント', system: '1φ2W', useVoltage: 100, groundVoltage: 100, testVoltage: 250, breakerA: 20, readings: { RE: { kind: 'value', mohm: 0.12 } }, source: 'manual' },
    { id: 's3', no: '3', name: '空調機 AC-1', system: '3φ3W', useVoltage: 200, groundVoltage: 200, testVoltage: 500, breakerA: 30, readings: { RS: { kind: 'value', mohm: 50 }, RE: { kind: 'value', mohm: 0.15 } }, source: 'manual' },
  ],
  sourceFiles: [],
};
