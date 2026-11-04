/**
 * 資料の取込・読み取り（CLAUDE.md §4）の型と zod スキーマ。
 * 読み取り結果は必ず利用者の確認を経てから報告書に反映する（自動確定しない）。
 */
import { z } from 'zod';
import { WiringSystemSchema } from './schema.ts';

/** 読み取り結果（Claude / OCR 共通）。読めない項目は null。 */
export const ExtractedCircuitSchema = z.object({
  no: z.string().nullable(),
  name: z.string().nullable(),
  system: WiringSystemSchema.nullable(),
  useVoltage: z.number().nullable(),
  breakerA: z.number().nullable(),
});
export type ExtractedCircuit = z.infer<typeof ExtractedCircuitSchema>;

export const ExtractionSchema = z.object({
  panel: z.object({ name: z.string().nullable(), location: z.string().nullable() }),
  circuits: z.array(ExtractedCircuitSchema),
  /** field の書式: "panel.name" / "panel.location" / "circuits.{0始まりの行番号}.{no|name|system|useVoltage|breakerA}" */
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
export const ConfirmBodySchema = z.object({
  /** new: 新しい報告書 / append: 既存報告書の回路の後ろに追加 / replace: 既存報告書の回路を置き換え */
  mode: z.enum(['new', 'append', 'replace']),
  targetReportId: z.string().optional(),
  /** 既存報告書に反映する場合、盤名・設置場所も上書きするか */
  applyPanel: z.boolean(),
  panel: z.object({ name: z.string(), location: z.string() }),
  circuits: z.array(
    z.object({
      no: z.string(),
      name: z.string(),
      system: WiringSystemSchema,
      useVoltage: z.number().positive(),
      breakerA: z.number().nonnegative().optional(),
    }),
  ),
});
export type ConfirmBody = z.infer<typeof ConfirmBodySchema>;

/** uncertain の field 名を作る */
export const circuitField = (i: number, key: keyof ExtractedCircuit) => `circuits.${i}.${key}`;

/** 複数回の読み取り結果（ページ分割時）を1つにまとめる。回路の行番号を付け替える。 */
export function mergeExtractions(parts: Extraction[]): Extraction {
  const out: Extraction = { panel: { name: null, location: null }, circuits: [], uncertain: [] };
  for (const p of parts) {
    const offset = out.circuits.length;
    if (out.panel.name === null && p.panel.name !== null) out.panel.name = p.panel.name;
    if (out.panel.location === null && p.panel.location !== null) out.panel.location = p.panel.location;
    out.circuits.push(...p.circuits);
    for (const u of p.uncertain) {
      const m = /^circuits\.(\d+)\.(.+)$/.exec(u.field);
      out.uncertain.push(m ? { ...u, field: `circuits.${Number(m[1]) + offset}.${m[2]}` } : u);
    }
  }
  // null の項目は uncertain に必ず載せる（理由が無ければ補う）
  const has = new Set(out.uncertain.map((u) => u.field));
  const need = (f: string) => !has.has(f) && out.uncertain.push({ field: f, reason: '読み取れませんでした' });
  if (out.panel.name === null) need('panel.name');
  out.circuits.forEach((c, i) => {
    for (const k of ['no', 'name', 'system', 'useVoltage'] as const) if (c[k] === null) need(circuitField(i, k));
  });
  return out;
}
