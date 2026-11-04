/**
 * 帳票モデル・測定データモデルの型と zod スキーマ（CLAUDE.md §5, §7）。
 * サーバー・クライアント・ドメイン層で共通に使う。
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// 帳票モデル（グリッド方式）
// ---------------------------------------------------------------------------

export const BorderStyleSchema = z.enum(['thin', 'medium', 'thick', 'double']);
export type BorderStyle = z.infer<typeof BorderStyleSchema>;

export const CellStyleSchema = z.object({
  font: z.string().optional(),
  sizePt: z.number().positive().optional(),
  bold: z.boolean().optional(),
  hAlign: z.enum(['left', 'center', 'right']).optional(),
  vAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  wrap: z.boolean().optional(),
  shrinkToFit: z.boolean().optional(),
  fill: z.string().optional(),
  border: z
    .object({
      t: BorderStyleSchema.optional(),
      r: BorderStyleSchema.optional(),
      b: BorderStyleSchema.optional(),
      l: BorderStyleSchema.optional(),
    })
    .optional(),
});
export type CellStyle = z.infer<typeof CellStyleSchema>;

export const CellSchema = z.object({
  value: z.string().optional(),
  style: CellStyleSchema.optional(),
  numFmt: z.string().optional(),
});
export type Cell = z.infer<typeof CellSchema>;

const RangeSchema = z.object({
  r1: z.number().int().nonnegative(),
  c1: z.number().int().nonnegative(),
  r2: z.number().int().nonnegative(),
  c2: z.number().int().nonnegative(),
});
export type Range = z.infer<typeof RangeSchema>;

export const SheetSchema = z
  .object({
    page: z.object({
      size: z.enum(['A4', 'A3']),
      orientation: z.enum(['portrait', 'landscape']),
      marginsMm: z.object({ t: z.number(), r: z.number(), b: z.number(), l: z.number() }),
      repeatHeaderRows: z.tuple([z.number().int(), z.number().int()]).optional(),
    }),
    colWidthsMm: z.array(z.number().positive()),
    rowHeightsMm: z.array(z.number().positive()),
    cells: z.record(z.string().regex(/^\d+,\d+$/), CellSchema),
    merges: z.array(RangeSchema),
    repeatRegion: z
      .object({
        rowStart: z.number().int().nonnegative(),
        rowEnd: z.number().int().nonnegative(),
        source: z.literal('circuits'),
      })
      .optional(),
    images: z.array(
      z.object({
        id: z.string(),
        anchor: z.object({ r: z.number().int(), c: z.number().int(), r2: z.number().int(), c2: z.number().int() }),
      }),
    ),
  })
  .superRefine((s, ctx) => {
    const rows = s.rowHeightsMm.length;
    const cols = s.colWidthsMm.length;
    for (const m of s.merges) {
      if (m.r1 > m.r2 || m.c1 > m.c2 || m.r2 >= rows || m.c2 >= cols) {
        ctx.addIssue({ code: 'custom', message: `結合範囲が不正です: ${JSON.stringify(m)}` });
      }
    }
    if (s.repeatRegion) {
      const { rowStart, rowEnd } = s.repeatRegion;
      if (rowStart > rowEnd || rowEnd >= rows) {
        ctx.addIssue({ code: 'custom', message: '繰り返し行範囲が不正です' });
      }
    }
    if (s.page.repeatHeaderRows) {
      const [a, b] = s.page.repeatHeaderRows;
      if (a < 0 || a > b || b >= rows) {
        ctx.addIssue({ code: 'custom', message: '見出し行範囲が不正です' });
      }
    }
  });
export type Sheet = z.infer<typeof SheetSchema>;

export const TemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  sheet: SheetSchema,
});
export type Template = z.infer<typeof TemplateSchema>;

// ---------------------------------------------------------------------------
// 測定データモデル
// ---------------------------------------------------------------------------

export const WIRING_SYSTEMS = ['1φ2W', '1φ3W', '3φ3W', '3φ4W'] as const;
export const WiringSystemSchema = z.enum(WIRING_SYSTEMS);
export type WiringSystem = z.infer<typeof WiringSystemSchema>;

export const TEST_VOLTAGES = [125, 250, 500] as const;
export const TestVoltageSchema = z.union([z.literal(125), z.literal(250), z.literal(500)]);

export const ReadingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('value'), mohm: z.number().nonnegative() }),
  z.object({ kind: z.literal('over'), mohm: z.number().nonnegative() }),
  z.object({ kind: z.literal('na') }),
]);
export type Reading = z.infer<typeof ReadingSchema>;

export const READING_KEYS = ['RS', 'ST', 'TR', 'RE', 'SE', 'TE', 'NE', 'ALL_E'] as const;
export type ReadingKey = (typeof READING_KEYS)[number];
export const READING_LABELS: Record<ReadingKey, string> = {
  RS: 'R-S',
  ST: 'S-T',
  TR: 'T-R',
  RE: 'R-E',
  SE: 'S-E',
  TE: 'T-E',
  NE: 'N-E',
  ALL_E: '一括-E',
};

export const CircuitSchema = z.object({
  id: z.string(),
  no: z.string(),
  name: z.string(),
  system: WiringSystemSchema,
  useVoltage: z.number().nonnegative(),
  groundVoltage: z.number().nonnegative(),
  testVoltage: TestVoltageSchema,
  breakerA: z.number().nonnegative().optional(),
  readings: z.object({
    RS: ReadingSchema.optional(),
    ST: ReadingSchema.optional(),
    TR: ReadingSchema.optional(),
    RE: ReadingSchema.optional(),
    SE: ReadingSchema.optional(),
    TE: ReadingSchema.optional(),
    NE: ReadingSchema.optional(),
    ALL_E: ReadingSchema.optional(),
  }),
  note: z.string().optional(),
  source: z.enum(['ai', 'ocr', 'manual']),
});
export type Circuit = z.infer<typeof CircuitSchema>;

export const ReportSchema = z.object({
  id: z.string(),
  templateId: z.string(),
  sheetOverride: SheetSchema.optional(),
  panel: z.object({ name: z.string(), location: z.string().optional() }),
  date: z.string(),
  inspector: z.string(),
  tempC: z.number().optional(),
  humidity: z.number().optional(),
  instrument: z.object({
    model: z.string(),
    serial: z.string().optional(),
    calDate: z.string().optional(),
  }),
  circuits: z.array(CircuitSchema),
  sourceFiles: z.array(z.string()),
});
export type Report = z.infer<typeof ReportSchema>;

export interface ReportSummary {
  id: string;
  panelName: string;
  location?: string;
  date: string;
  inspector: string;
  circuitCount: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

/** 判定基準（電気設備技術基準 第58条）。設定画面では確認のみ（編集不可）とする。 */
export const CriteriaSchema = z.object({
  /** 使用電圧の区分境界 [V]（この値以下が「300V以下」） */
  useVoltageLimit: z.number(),
  /** 対地電圧の区分境界 [V]（この値以下が「150V以下」） */
  groundVoltageLimit: z.number(),
  /** 300V以下・対地150V以下 の基準値 [MΩ] */
  lowGroundMohm: z.number(),
  /** 300V以下・上記以外 の基準値 [MΩ] */
  lowOtherMohm: z.number(),
  /** 300V超 の基準値 [MΩ] */
  highMohm: z.number(),
});
export type Criteria = z.infer<typeof CriteriaSchema>;

export const DEFAULT_CRITERIA: Criteria = {
  useVoltageLimit: 300,
  groundVoltageLimit: 150,
  lowGroundMohm: 0.1,
  lowOtherMohm: 0.2,
  highMohm: 0.4,
};

export const InstrumentSchema = z.object({
  id: z.string(),
  model: z.string(),
  serial: z.string().optional(),
  calDate: z.string().optional(),
});
export type Instrument = z.infer<typeof InstrumentSchema>;

export const SettingsSchema = z.object({
  aiExtraction: z.boolean(),
  /**
   * 列幅換算係数 [mm / 文字]（Excel 列幅 = (mm − 1.32) ÷ 係数）。
   * 既定 1.85 は Excel の標準フォント Calibri 11pt（数字幅 7px、96dpi）からの理論値。実機で校正する（不確か）。
   */
  colWidthMmPerChar: z.number().positive(),
  instruments: z.array(InstrumentSchema),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  // 社内ルール確認前のため既定は OFF（CLAUDE.md §4 情報管理）
  aiExtraction: false,
  colWidthMmPerChar: 1.85,
  instruments: [],
};
