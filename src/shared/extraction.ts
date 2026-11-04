/**
 * 資料の取込・読み取り（CLAUDE.md §4）の型と zod スキーマ。
 * 読み取り結果は必ず利用者の確認を経てから報告書に反映する（自動確定しない）。
 */
import { z } from 'zod';
import { WiringSystemSchema } from './schema.ts';

/** 読み取り結果（Claude / OCR 共通）。読めない項目は null。1つの資料に盤が複数あれば panels に複数入る。 */
export const ExtractedCircuitSchema = z.object({
  no: z.string().nullable(),
  name: z.string().nullable(),
  system: WiringSystemSchema.nullable(),
  /** 器具の種別（ELB・MCB・Mg など。見出しの「ELB No.」「MCB No.」から） */
  deviceType: z.string().nullable().optional(),
  useVoltage: z.number().nullable(),
  /** 電圧の表記（資料に書かれたまま。例: "105/210V"）。「105/210」の判別に使う */
  voltageText: z.string().nullable().optional(),
  breakerA: z.number().nullable(),
});
export type ExtractedCircuit = z.infer<typeof ExtractedCircuitSchema>;

export const ExtractedPanelSchema = z.object({
  name: z.string().nullable(),
  location: z.string().nullable(),
  circuits: z.array(ExtractedCircuitSchema),
});
export type ExtractedPanel = z.infer<typeof ExtractedPanelSchema>;

export const ExtractionSchema = z.object({
  panels: z.array(ExtractedPanelSchema),
  /**
   * field の書式（番号は 0 始まり）:
   *   "panels.{盤}.name" / "panels.{盤}.location" / "panels.{盤}.circuits.{行}.{no|name|system|useVoltage|breakerA}"
   */
  uncertain: z.array(z.object({ field: z.string(), reason: z.string() })),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export const ImportPageSchema = z.object({
  index: z.number().int(),
  fileIndex: z.number().int(),
  fileName: z.string(),
  /** PDF のページ番号（1始まり）。画像は 1 */
  pageNo: z.number().int(),
  kind: z.enum(['pdf-text', 'pdf-scan', 'image']),
  image: z.string(),
  width: z.number(),
  height: z.number(),
  /** テキスト PDF の文字（"x,y: 文字列" の行。座標はページ画像のピクセル） */
  text: z.string().optional(),
});
export type ImportPage = z.infer<typeof ImportPageSchema>;

export const ImportRecordSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  targetReportId: z.string().optional(),
  files: z.array(z.object({ name: z.string(), stored: z.string(), type: z.string() })),
  pages: z.array(ImportPageSchema),
  status: z.enum(['uploaded', 'extracting', 'extracted', 'failed', 'confirmed']),
  engine: z.enum(['ai', 'ocr']).optional(),
  model: z.string().optional(),
  result: ExtractionSchema.optional(),
  error: z.string().optional(),
  confirmedReportId: z.string().optional(),
});
export type ImportRecord = z.infer<typeof ImportRecordSchema>;

/** 確認・修正画面で利用者が確定した内容 */
export const ConfirmPanelSchema = z.object({
  panel: z.object({ name: z.string(), location: z.string() }),
  circuits: z.array(
    z.object({
      no: z.string(),
      name: z.string(),
      /** 空欄（''）なら、使用電圧も空欄（0） */
      system: z.union([WiringSystemSchema, z.literal('')]),
      deviceType: z.string().optional(),
      useVoltage: z.number().nonnegative(),
      voltageLabel: z.string().optional(),
      breakerA: z.number().nonnegative().optional(),
    }),
  ),
});
export type ConfirmPanel = z.infer<typeof ConfirmPanelSchema>;

export const ConfirmBodySchema = z
  .object({
    /** new: 盤ごとに新しい報告書 / append: 既存報告書の回路の後ろに追加 / replace: 既存報告書の回路を置き換え */
    mode: z.enum(['new', 'append', 'replace']),
    targetReportId: z.string().optional(),
    /** 既存報告書に反映する場合、盤名・設置場所も上書きするか */
    applyPanel: z.boolean(),
    panels: z.array(ConfirmPanelSchema).min(1),
  })
  .superRefine((b, ctx) => {
    if (b.mode !== 'new' && b.panels.length !== 1) {
      ctx.addIssue({ code: 'custom', message: '既存の報告書に反映できるのは1つの盤だけです' });
    }
  });
export type ConfirmBody = z.infer<typeof ConfirmBodySchema>;

/** uncertain の field 名を作る */
export const panelField = (p: number, key: 'name' | 'location') => `panels.${p}.${key}`;
export const circuitField = (p: number, i: number, key: keyof ExtractedCircuit) => `panels.${p}.circuits.${i}.${key}`;

/** 複数回の読み取り結果（ページ分割時）を1つにまとめる。盤の番号を付け替える。 */
export function mergeExtractions(parts: Extraction[]): Extraction {
  const out: Extraction = { panels: [], uncertain: [] };
  for (const part of parts) {
    const offset = out.panels.length;
    out.panels.push(...part.panels);
    for (const u of part.uncertain) {
      const m = /^panels\.(\d+)\.(.+)$/.exec(u.field);
      out.uncertain.push(m ? { ...u, field: `panels.${Number(m[1]) + offset}.${m[2]}` } : u);
    }
  }
  // null の項目は uncertain に必ず載せる（理由が無ければ補う）
  const has = new Set(out.uncertain.map((u) => u.field));
  const need = (f: string) => !has.has(f) && out.uncertain.push({ field: f, reason: '読み取れませんでした' });
  out.panels.forEach((pn, p) => {
    if (pn.name === null) need(panelField(p, 'name'));
    pn.circuits.forEach((c, i) => {
      for (const k of ['no', 'name', 'system', 'useVoltage'] as const) if (c[k] === null) need(circuitField(p, i, k));
    });
  });
  return out;
}
