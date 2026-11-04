import type { Report } from '../shared/schema.ts';

/** テスト用の報告書（日本語・Ω・φ・髙 を含む） */
export function sampleReport(n: number): Report {
  return {
    id: 'pdf-test',
    templateId: 'default',
    panel: { name: '動力盤 P-1（3φ3W 200V）', location: '髙島屋ビル 地下1階 電気室' },
    date: '2026-11-04',
    inspector: '髙橋 太郎',
    tempC: 22,
    humidity: 55,
    instrument: { model: '絶縁抵抗計 MΩ-500', serial: 'SN-0001', calDate: '2026-04-01' },
    circuits: Array.from({ length: n }, (_, i) => ({
      id: String(i),
      no: String(i + 1),
      name: i % 3 === 0 ? `空調機 AC-${i + 1}（髙効率）` : `照明 1φ3W 回路${i + 1}`,
      system: i % 3 === 0 ? ('3φ3W' as const) : ('1φ3W' as const),
      useVoltage: i % 3 === 0 ? 200 : 200,
      groundVoltage: i % 3 === 0 ? 200 : 100,
      testVoltage: 250 as const,
      readings:
        i === 4
          ? { RE: { kind: 'value' as const, mohm: 0.15 } }
          : { RE: { kind: 'value' as const, mohm: 100 + i }, SE: { kind: 'na' as const }, ALL_E: { kind: 'over' as const, mohm: 2000 } },
      source: 'manual' as const,
    })),
    sourceFiles: [],
  };
}
