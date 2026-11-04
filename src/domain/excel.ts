/**
 * Sheet（展開済み）→ Excel（ExcelJS）。CLAUDE.md §5, §6。サーバーとブラウザの両方で使う。
 * - 数式は使わず、判定結果も値として書き込む
 * - 用紙・余白・印刷範囲・繰り返し見出し行（printTitlesRow）を設定する
 * - 行高: pt = mm × 72 / 25.4
 * - 列幅: Excel の文字数単位 = (mm − 余白5px相当) ÷ 換算係数（近似。実機で校正する。不確か）
 * - 結合セルは左上セルの書式を範囲全体に使う（PDF と同じ）。罫線は範囲の外周に付ける。
 */
import ExcelJS from 'exceljs';
import type { BorderStyle, Cell, Sheet } from '../shared/schema.ts';
import { DEFAULT_FONT_PT } from './renderHtml.ts';
import { parseKey } from './generate.ts';

/** Excel の既定フォント（PDF の第1候補と同じ。Windows 10 以降に標準搭載） */
export const EXCEL_FONT = 'BIZ UDゴシック';
/** Excel の列のセル内余白（5px）を mm にしたもの（96dpi 前提） */
const COL_PADDING_MM = (5 * 25.4) / 96;

export const mmToPt = (mm: number) => (mm * 72) / 25.4;
export const mmToInch = (mm: number) => mm / 25.4;

/** 列幅 mm → Excel 列幅（文字数単位）。係数は設定画面の「列幅換算係数」。 */
export function mmToExcelWidth(mm: number, mmPerChar: number): number {
  return Math.max(0.5, Math.round(((mm - COL_PADDING_MM) / mmPerChar) * 100) / 100);
}

/** A1 形式の列名 */
export function colName(c: number): string {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const NUMBER_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;

function excelBorder(b: BorderStyle | undefined): Partial<ExcelJS.Border> | undefined {
  return b ? { style: b, color: { argb: 'FF000000' } } : undefined;
}

function argb(color: string): string | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  return m ? `FF${m[1]!.toUpperCase()}` : undefined;
}

export interface XlsxOptions {
  colWidthMmPerChar: number;
  title?: string;
}

/** Excel のシート名にできる形にする（使えない文字は _、31文字まで）。空なら既定名 */
export function safeSheetName(title: string, fallback = '報告書'): string {
  return title.replace(/[\\/?*[\]:]/g, '_').replace(/^'+|'+$/g, '').trim().slice(0, 31) || fallback;
}

/** 同じ名前のシートができないように、2・3…を付けて重複を避ける（Excel のシート名は大文字小文字を区別しない） */
export function uniqueSheetNames(titles: string[]): string[] {
  const used = new Set<string>();
  return titles.map((t, i) => {
    const base = safeSheetName(t, `報告書${i + 1}`);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

/** 1つの Excel ファイルに、複数のシート（報告書1件につき1シート）を入れる。一括出力用。 */
export async function sheetsToXlsx(items: { sheet: Sheet; title: string }[], opts: Omit<XlsxOptions, 'title'>): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '絶縁抵抗測定報告書アプリ';
  const names = uniqueSheetNames(items.map((i) => i.title));
  items.forEach((item, i) => addSheetTo(wb, item.sheet, names[i]!, opts));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export async function sheetToXlsx(sheet: Sheet, opts: XlsxOptions): Promise<Uint8Array> {
  return sheetsToXlsx([{ sheet, title: opts.title || '報告書' }], opts);
}

function addSheetTo(wb: ExcelJS.Workbook, sheet: Sheet, name: string, opts: Omit<XlsxOptions, 'title'>): void {
  const rows = sheet.rowHeightsMm.length;
  const cols = sheet.colWidthsMm.length;
  const m = sheet.page.marginsMm;

  const ws = wb.addWorksheet(name, {
    pageSetup: {
      // 9 = A4, 8 = A3（ExcelJS の型定義に A3 が無いためキャスト）
      paperSize: (sheet.page.size === 'A3' ? 8 : 9) as unknown as ExcelJS.PaperSize,
      orientation: sheet.page.orientation,
      margins: { top: mmToInch(m.t), right: mmToInch(m.r), bottom: mmToInch(m.b), left: mmToInch(m.l), header: 0, footer: 0 },
      // 列幅換算の誤差で横にはみ出さないよう、横1ページに収める（縦は成り行き）
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printArea: `A1:${colName(cols - 1)}${rows}`,
      ...(sheet.page.repeatHeaderRows
        ? { printTitlesRow: `${sheet.page.repeatHeaderRows[0] + 1}:${sheet.page.repeatHeaderRows[1] + 1}` }
        : {}),
    },
    views: [{ showGridLines: false }],
  });

  sheet.colWidthsMm.forEach((mm, c) => (ws.getColumn(c + 1).width = mmToExcelWidth(mm, opts.colWidthMmPerChar)));
  sheet.rowHeightsMm.forEach((mm, r) => (ws.getRow(r + 1).height = Math.round(mmToPt(mm) * 100) / 100));

  // 結合範囲: 左上セル → 範囲
  const mergeOf = new Map<string, Sheet['merges'][number]>();
  for (const mg of sheet.merges) {
    for (let r = mg.r1; r <= mg.r2; r++) for (let c = mg.c1; c <= mg.c2; c++) mergeOf.set(`${r},${c}`, mg);
  }

  const writeCell = (r: number, c: number, cell: Cell, border: Partial<ExcelJS.Borders>, isAnchor: boolean) => {
    const xc = ws.getCell(r + 1, c + 1);
    const s = cell.style ?? {};
    if (isAnchor && cell.value !== undefined && cell.value !== '') {
      xc.value = NUMBER_RE.test(cell.value) ? Number(cell.value) : cell.value;
    }
    const fill = s.fill ? argb(s.fill) : undefined;
    // 結合セルは ExcelJS 内で書式オブジェクトを共有するため、セルごとに新しいオブジェクトを代入する
    xc.style = {
      font: { name: s.font ?? EXCEL_FONT, size: s.sizePt ?? DEFAULT_FONT_PT, bold: Boolean(s.bold) },
      alignment: {
        horizontal: s.hAlign ?? 'left',
        vertical: s.vAlign === 'top' ? 'top' : s.vAlign === 'bottom' ? 'bottom' : 'middle',
        wrapText: Boolean(s.wrap),
        shrinkToFit: Boolean(s.shrinkToFit) && !s.wrap,
      },
      ...(fill ? { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } } } : {}),
      ...(Object.keys(border).length ? { border } : {}),
      ...(cell.numFmt && isAnchor ? { numFmt: cell.numFmt } : {}),
    };
  };

  // 通常セル
  for (const [k, cell] of Object.entries(sheet.cells)) {
    const [r, c] = parseKey(k);
    if (r >= rows || c >= cols || mergeOf.has(k)) continue;
    const b = cell.style?.border ?? {};
    const border: Partial<ExcelJS.Borders> = {};
    if (b.t) border.top = excelBorder(b.t)!;
    if (b.r) border.right = excelBorder(b.r)!;
    if (b.b) border.bottom = excelBorder(b.b)!;
    if (b.l) border.left = excelBorder(b.l)!;
    writeCell(r, c, cell, border, true);
  }

  // 結合セル: 左上の書式を範囲内の全セルに付け、罫線は外周だけに付ける。
  // （ExcelJS は結合時に左上の書式を全セルへ複写するため、先に結合してから各セルの書式を書く）
  for (const mg of sheet.merges) {
    if (mg.r2 >= rows || mg.c2 >= cols) continue;
    if (mg.r1 !== mg.r2 || mg.c1 !== mg.c2) ws.mergeCells(mg.r1 + 1, mg.c1 + 1, mg.r2 + 1, mg.c2 + 1);
    const anchor = sheet.cells[`${mg.r1},${mg.c1}`] ?? {};
    const b = anchor.style?.border ?? {};
    for (let r = mg.r1; r <= mg.r2; r++) {
      for (let c = mg.c1; c <= mg.c2; c++) {
        const border: Partial<ExcelJS.Borders> = {};
        if (r === mg.r1 && b.t) border.top = excelBorder(b.t)!;
        if (r === mg.r2 && b.b) border.bottom = excelBorder(b.b)!;
        if (c === mg.c1 && b.l) border.left = excelBorder(b.l)!;
        if (c === mg.c2 && b.r) border.right = excelBorder(b.r)!;
        writeCell(r, c, anchor, border, r === mg.r1 && c === mg.c1);
      }
    }
  }


}
