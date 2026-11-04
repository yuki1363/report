/**
 * 空欄の書式（印刷して手書きするひな形・Excel の白紙様式）を作る純粋関数。
 * 回路行（repeatRegion）を指定行数ぶん複製し、差し込み項目（{{…}}）を空欄にする。
 * 固定の文字（「盤名：」などのラベル）はそのまま残る。
 */
import type { Sheet } from '../shared/schema.ts';
import { BINDINGS, resolveBindings } from './generate.ts';
import { insertRows } from './sheetOps.ts';

export function blankForm(template: Sheet, circuitRows = 20): Sheet {
  let sheet: Sheet = structuredClone(template);
  const region = sheet.repeatRegion;
  if (region) {
    const h = region.rowEnd - region.rowStart + 1;
    const n = Math.max(1, Math.round(circuitRows));
    const block = sheet.rowHeightsMm.slice(region.rowStart, region.rowEnd + 1);
    const merges = sheet.merges.filter((m) => m.r1 >= region.rowStart && m.r2 <= region.rowEnd);
    const cells = Object.entries(sheet.cells).filter(([k]) => {
      const r = Number(k.split(',')[0]);
      return r >= region.rowStart && r <= region.rowEnd;
    });
    // 繰り返し範囲の直後に (n-1) ブロック分の行を挿入してから、内容と結合を複写する
    if (n > 1) sheet = insertRows(sheet, region.rowEnd + 1, h * (n - 1));
    for (let i = 1; i < n; i++) {
      block.forEach((mm, j) => (sheet.rowHeightsMm[region.rowStart + i * h + j] = mm));
      for (const [k, cell] of cells) {
        const [r, c] = k.split(',').map(Number) as [number, number];
        sheet.cells[`${r + i * h},${c}`] = structuredClone(cell);
      }
      for (const m of merges) sheet.merges.push({ ...m, r1: m.r1 + i * h, r2: m.r2 + i * h });
    }
    delete sheet.repeatRegion;
  }
  const empty = Object.fromEntries(BINDINGS.map((b) => [b.key, '']));
  for (const cell of Object.values(sheet.cells)) {
    if (cell.value) cell.value = resolveBindings(cell.value, empty);
  }
  return sheet;
}
