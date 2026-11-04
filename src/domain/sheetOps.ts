/**
 * 書式エディタ用の Sheet 操作（純粋関数。すべて新しい Sheet を返す）。
 * 行・列の挿入/削除に合わせて、セル・結合・繰り返し行・見出し行・画像の位置も更新する。
 */
import type { BorderStyle, Cell, CellStyle, Range, Sheet } from '../shared/schema.ts';
import { parseKey } from './generate.ts';

export type { Range };

const key = (r: number, c: number) => `${r},${c}`;

export function normRange(a: { r: number; c: number }, b: { r: number; c: number }): Range {
  return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
}

const overlaps = (a: Range, b: Range) => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;

/** 範囲を、重なる結合セル全体を含むように広げる */
export function expandToMerges(sheet: Sheet, range: Range): Range {
  let r = { ...range };
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of sheet.merges) {
      if (overlaps(r, m) && (m.r1 < r.r1 || m.c1 < r.c1 || m.r2 > r.r2 || m.c2 > r.c2)) {
        r = { r1: Math.min(r.r1, m.r1), c1: Math.min(r.c1, m.c1), r2: Math.max(r.r2, m.r2), c2: Math.max(r.c2, m.c2) };
        changed = true;
      }
    }
  }
  return r;
}

export function mergeAt(sheet: Sheet, r: number, c: number): Range | undefined {
  return sheet.merges.find((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2);
}

function eachCell(range: Range, fn: (r: number, c: number) => void) {
  for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) fn(r, c);
}

// ---------------------------------------------------------------------------
// 値・書式
// ---------------------------------------------------------------------------

export function setValue(sheet: Sheet, r: number, c: number, value: string): Sheet {
  const cells = { ...sheet.cells };
  const cur = cells[key(r, c)] ?? {};
  const next: Cell = { ...cur };
  if (value === '') delete next.value;
  else next.value = value;
  if (next.value === undefined && !next.style && !next.numFmt) delete cells[key(r, c)];
  else cells[key(r, c)] = next;
  return { ...sheet, cells };
}

export function clearValues(sheet: Sheet, range: Range): Sheet {
  const cells = { ...sheet.cells };
  eachCell(range, (r, c) => {
    const cur = cells[key(r, c)];
    if (!cur) return;
    const { value: _v, ...rest } = cur;
    if (!rest.style && !rest.numFmt) delete cells[key(r, c)];
    else cells[key(r, c)] = rest;
  });
  return { ...sheet, cells };
}

/** 範囲のセルに書式を部分適用する（undefined のキーは削除） */
export function applyStyle(sheet: Sheet, range: Range, patch: Partial<CellStyle>): Sheet {
  const cells = { ...sheet.cells };
  eachCell(range, (r, c) => {
    const cur = cells[key(r, c)] ?? {};
    const style: CellStyle = { ...cur.style };
    for (const [k, v] of Object.entries(patch) as [keyof CellStyle, unknown][]) {
      if (v === undefined) delete style[k];
      else (style as Record<string, unknown>)[k] = v;
    }
    cells[key(r, c)] = { ...cur, style };
  });
  return { ...sheet, cells };
}

export function setNumFmt(sheet: Sheet, range: Range, numFmt: string | undefined): Sheet {
  const cells = { ...sheet.cells };
  eachCell(range, (r, c) => {
    const cur = { ...(cells[key(r, c)] ?? {}) };
    if (numFmt) cur.numFmt = numFmt;
    else delete cur.numFmt;
    cells[key(r, c)] = cur;
  });
  return { ...sheet, cells };
}

export type BorderMode = 'all' | 'outer' | 'inner' | 'top' | 'bottom' | 'left' | 'right' | 'none';

/**
 * 罫線。結合セルは左上セルの罫線が範囲全体に使われるため、結合の左上にも外周の罫線を書く。
 */
export function applyBorder(sheet: Sheet, range: Range, mode: BorderMode, style: BorderStyle): Sheet {
  const cells = { ...sheet.cells };
  const set = (r: number, c: number, side: 't' | 'r' | 'b' | 'l', v: BorderStyle | undefined) => {
    const cur = cells[key(r, c)] ?? {};
    const border = { ...cur.style?.border };
    if (v) border[side] = v;
    else delete border[side];
    cells[key(r, c)] = { ...cur, style: { ...cur.style, border } };
  };
  eachCell(range, (r, c) => {
    const top = r === range.r1, bottom = r === range.r2, left = c === range.c1, right = c === range.c2;
    const want = (side: 't' | 'r' | 'b' | 'l', outer: boolean): BorderStyle | undefined | null => {
      switch (mode) {
        case 'all': return style;
        case 'none': return undefined;
        case 'outer': return outer ? style : null;
        case 'inner': return outer ? null : style;
        case 'top': return side === 't' && top ? style : null;
        case 'bottom': return side === 'b' && bottom ? style : null;
        case 'left': return side === 'l' && left ? style : null;
        case 'right': return side === 'r' && right ? style : null;
      }
    };
    const sides: ['t' | 'r' | 'b' | 'l', boolean][] = [['t', top], ['r', right], ['b', bottom], ['l', left]];
    for (const [side, outer] of sides) {
      const v = want(side, outer);
      if (v !== null) set(r, c, side, v);
    }
  });
  // 結合セルの左上へ、範囲外周の罫線を反映
  let out: Sheet = { ...sheet, cells };
  for (const m of sheet.merges) {
    if (!overlaps(m, range)) continue;
    const anchor = { ...(out.cells[key(m.r1, m.c1)] ?? {}) };
    const border = { ...anchor.style?.border };
    const edge = (side: 't' | 'r' | 'b' | 'l', r: number, c: number) => {
      const b = out.cells[key(r, c)]?.style?.border?.[side];
      if (b) border[side] = b;
      else delete border[side];
    };
    edge('b', m.r2, m.c1);
    edge('r', m.r1, m.c2);
    anchor.style = { ...anchor.style, border };
    out = { ...out, cells: { ...out.cells, [key(m.r1, m.c1)]: anchor } };
  }
  return out;
}

// ---------------------------------------------------------------------------
// 結合
// ---------------------------------------------------------------------------

/** 結合。重なる既存の結合は解除してから結合し、左上以外の値は消す（Excel と同じ）。 */
export function mergeCells(sheet: Sheet, range: Range): Sheet {
  if (range.r1 === range.r2 && range.c1 === range.c2) return sheet;
  const merges = sheet.merges.filter((m) => !overlaps(m, range));
  merges.push({ ...range });
  const cells = { ...sheet.cells };
  eachCell(range, (r, c) => {
    if (r === range.r1 && c === range.c1) return;
    const cur = cells[key(r, c)];
    if (cur?.value !== undefined) {
      const { value: _v, ...rest } = cur;
      cells[key(r, c)] = rest;
    }
  });
  return { ...sheet, merges, cells };
}

export function unmergeCells(sheet: Sheet, range: Range): Sheet {
  return { ...sheet, merges: sheet.merges.filter((m) => !overlaps(m, range)) };
}

// ---------------------------------------------------------------------------
// 行・列の挿入/削除
// ---------------------------------------------------------------------------

type Axis = 'row' | 'col';

function shiftIndex(i: number, at: number, delta: number): number | null {
  if (delta > 0) return i >= at ? i + delta : i;
  const end = at - delta; // 削除範囲 [at, end)
  if (i < at) return i;
  if (i < end) return null;
  return i + delta;
}

/** 範囲 [a,b] の端を挿入/削除に合わせて動かす。全体が消える場合は null */
function shiftSpan(a: number, b: number, at: number, delta: number): [number, number] | null {
  if (delta > 0) return [a >= at ? a + delta : a, b >= at ? b + delta : b];
  const end = at - delta;
  const na = a < at ? a : a < end ? at : a + delta;
  const nb = b < at ? b : b < end ? at - 1 : b + delta;
  return nb < na ? null : [na, nb];
}

function shiftAxis(sheet: Sheet, axis: Axis, at: number, delta: number, size: number[]): Sheet {
  const cells: Record<string, Cell> = {};
  for (const [k, v] of Object.entries(sheet.cells)) {
    const [r, c] = parseKey(k);
    const i = axis === 'row' ? r : c;
    const ni = shiftIndex(i, at, delta);
    if (ni === null) continue;
    cells[axis === 'row' ? key(ni, c) : key(r, ni)] = v;
  }
  const merges: Sheet['merges'] = [];
  for (const m of sheet.merges) {
    const span = axis === 'row' ? shiftSpan(m.r1, m.r2, at, delta) : shiftSpan(m.c1, m.c2, at, delta);
    if (!span) continue;
    const nm = axis === 'row' ? { ...m, r1: span[0], r2: span[1] } : { ...m, c1: span[0], c2: span[1] };
    if (nm.r1 !== nm.r2 || nm.c1 !== nm.c2) merges.push(nm);
  }
  const images = sheet.images.flatMap((im) => {
    const a = im.anchor;
    const span = axis === 'row' ? shiftSpan(a.r, a.r2, at, delta) : shiftSpan(a.c, a.c2, at, delta);
    if (!span) return [];
    return [{ ...im, anchor: axis === 'row' ? { ...a, r: span[0], r2: span[1] } : { ...a, c: span[0], c2: span[1] } }];
  });
  const out: Sheet = { ...sheet, cells, merges, images };
  if (axis === 'row') {
    out.rowHeightsMm = size;
    if (sheet.repeatRegion) {
      const span = shiftSpan(sheet.repeatRegion.rowStart, sheet.repeatRegion.rowEnd, at, delta);
      if (span) out.repeatRegion = { ...sheet.repeatRegion, rowStart: span[0], rowEnd: span[1] };
      else delete out.repeatRegion;
    }
    const rh = sheet.page.repeatHeaderRows;
    if (rh) {
      const span = shiftSpan(rh[0], rh[1], at, delta);
      const { repeatHeaderRows: _x, ...page } = sheet.page;
      out.page = span ? { ...page, repeatHeaderRows: span } : page;
    }
  } else {
    out.colWidthsMm = size;
  }
  return out;
}

export function insertRows(sheet: Sheet, at: number, count = 1, heightMm?: number): Sheet {
  const h = heightMm ?? sheet.rowHeightsMm[Math.max(0, at - 1)] ?? 7;
  const size = [...sheet.rowHeightsMm];
  size.splice(at, 0, ...Array<number>(count).fill(h));
  // 挿入位置の上の行の書式（値以外）を引き継ぐ
  let out = shiftAxis(sheet, 'row', at, count, size);
  if (at > 0) {
    const cells = { ...out.cells };
    for (let c = 0; c < sheet.colWidthsMm.length; c++) {
      const above = sheet.cells[key(at - 1, c)];
      if (above?.style || above?.numFmt) {
        for (let i = 0; i < count; i++) cells[key(at + i, c)] = { ...(above.style ? { style: above.style } : {}), ...(above.numFmt ? { numFmt: above.numFmt } : {}) };
      }
    }
    out = { ...out, cells };
  }
  return out;
}

export function deleteRows(sheet: Sheet, at: number, count = 1): Sheet {
  if (sheet.rowHeightsMm.length - count < 1) return sheet;
  const size = [...sheet.rowHeightsMm];
  size.splice(at, count);
  return shiftAxis(sheet, 'row', at, -count, size);
}

export function insertCols(sheet: Sheet, at: number, count = 1, widthMm?: number): Sheet {
  const w = widthMm ?? sheet.colWidthsMm[Math.max(0, at - 1)] ?? 15;
  const size = [...sheet.colWidthsMm];
  size.splice(at, 0, ...Array<number>(count).fill(w));
  return shiftAxis(sheet, 'col', at, count, size);
}

export function deleteCols(sheet: Sheet, at: number, count = 1): Sheet {
  if (sheet.colWidthsMm.length - count < 1) return sheet;
  const size = [...sheet.colWidthsMm];
  size.splice(at, count);
  return shiftAxis(sheet, 'col', at, -count, size);
}

export function setColWidth(sheet: Sheet, c: number, mm: number): Sheet {
  const colWidthsMm = [...sheet.colWidthsMm];
  colWidthsMm[c] = Math.max(1, Math.round(mm * 10) / 10);
  return { ...sheet, colWidthsMm };
}

export function setRowHeight(sheet: Sheet, r: number, mm: number): Sheet {
  const rowHeightsMm = [...sheet.rowHeightsMm];
  rowHeightsMm[r] = Math.max(1, Math.round(mm * 10) / 10);
  return { ...sheet, rowHeightsMm };
}

// ---------------------------------------------------------------------------
// コピー・貼り付け
// ---------------------------------------------------------------------------

export interface ClipData {
  rows: number;
  cols: number;
  cells: Record<string, Cell>; // 相対位置 "r,c"
  merges: Range[]; // 相対位置
}

export function copyRange(sheet: Sheet, range: Range): ClipData {
  const cells: Record<string, Cell> = {};
  eachCell(range, (r, c) => {
    const v = sheet.cells[key(r, c)];
    if (v) cells[key(r - range.r1, c - range.c1)] = structuredClone(v);
  });
  const merges = sheet.merges
    .filter((m) => m.r1 >= range.r1 && m.r2 <= range.r2 && m.c1 >= range.c1 && m.c2 <= range.c2)
    .map((m) => ({ r1: m.r1 - range.r1, c1: m.c1 - range.c1, r2: m.r2 - range.r1, c2: m.c2 - range.c1 }));
  return { rows: range.r2 - range.r1 + 1, cols: range.c2 - range.c1 + 1, cells, merges };
}

/** TSV（他のアプリへの貼り付け用） */
export function clipToTsv(clip: ClipData): string {
  const lines: string[] = [];
  for (let r = 0; r < clip.rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < clip.cols; c++) row.push((clip.cells[key(r, c)]?.value ?? '').replace(/[\t\n]/g, ' '));
    lines.push(row.join('\t'));
  }
  return lines.join('\n');
}

export function tsvToClip(text: string): ClipData {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const cells: Record<string, Cell> = {};
  let cols = 1;
  lines.forEach((line, r) => {
    const parts = line.split('\t');
    cols = Math.max(cols, parts.length);
    parts.forEach((v, c) => v !== '' && (cells[key(r, c)] = { value: v }));
  });
  return { rows: lines.length, cols, cells, merges: [] };
}

/**
 * 貼り付け。シートからはみ出す部分は切り捨てる。
 * withStyle=false（他アプリからの文字だけ）の場合は、貼り付け先の書式を残して値だけ置き換える。
 */
export function pasteClip(sheet: Sheet, at: { r: number; c: number }, clip: ClipData, withStyle: boolean): Sheet {
  const rows = sheet.rowHeightsMm.length, cols = sheet.colWidthsMm.length;
  const target: Range = { r1: at.r, c1: at.c, r2: Math.min(rows - 1, at.r + clip.rows - 1), c2: Math.min(cols - 1, at.c + clip.cols - 1) };
  let out = withStyle ? unmergeCells(sheet, target) : sheet;
  const cells = { ...out.cells };
  eachCell(target, (r, c) => {
    const src = clip.cells[key(r - at.r, c - at.c)];
    const cur = cells[key(r, c)];
    if (withStyle) {
      if (src) cells[key(r, c)] = structuredClone(src);
      else delete cells[key(r, c)];
    } else {
      const next: Cell = { ...cur };
      if (src?.value) next.value = src.value;
      else delete next.value;
      cells[key(r, c)] = next;
    }
  });
  out = { ...out, cells };
  if (withStyle) {
    const merges = [...out.merges];
    for (const m of clip.merges) {
      const nm = { r1: m.r1 + at.r, c1: m.c1 + at.c, r2: m.r2 + at.r, c2: m.c2 + at.c };
      if (nm.r2 < rows && nm.c2 < cols) merges.push(nm);
    }
    out = { ...out, merges };
  }
  return out;
}

/** 繰り返し行（回路数ぶん複製）の指定。境界をまたぐ結合がある場合はエラー文字列を返す。 */
export function setRepeatRegion(sheet: Sheet, rowStart: number, rowEnd: number): Sheet | string {
  const crosses = sheet.merges.some((m) => (m.r1 < rowStart && m.r2 >= rowStart) || (m.r1 <= rowEnd && m.r2 > rowEnd));
  if (crosses) return '繰り返し行の境界をまたぐ結合セルがあります。結合を解除してから指定してください。';
  return { ...sheet, repeatRegion: { rowStart, rowEnd, source: 'circuits' } };
}

export function setRepeatHeaderRows(sheet: Sheet, a: number, b: number): Sheet | string {
  const crosses = sheet.merges.some((m) => (m.r1 < a && m.r2 >= a) || (m.r1 <= b && m.r2 > b));
  if (crosses) return '見出し行の境界をまたぐ結合セルがあります。結合を解除してから指定してください。';
  if (sheet.repeatRegion && a <= sheet.repeatRegion.rowEnd && b >= sheet.repeatRegion.rowStart) {
    return '見出し行と繰り返し行（回路行）が重なっています。';
  }
  return { ...sheet, page: { ...sheet.page, repeatHeaderRows: [a, b] } };
}

/** 書式の問題点（保存前の確認用） */
export function sheetWarnings(sheet: Sheet): string[] {
  const out: string[] = [];
  if (!sheet.repeatRegion) out.push('繰り返し行（回路行）が指定されていません。回路は1件目しか出力されません。');
  const hasCircuitBinding = Object.values(sheet.cells).some((c) => c.value?.includes('{{c.'));
  if (sheet.repeatRegion && !hasCircuitBinding) out.push('回路の項目（{{c.…}}）がどのセルにもありません。');
  if (sheet.repeatRegion) {
    for (const [k, c] of Object.entries(sheet.cells)) {
      const [r] = parseKey(k);
      if (c.value?.includes('{{c.') && (r < sheet.repeatRegion.rowStart || r > sheet.repeatRegion.rowEnd)) {
        out.push(`回路の項目が繰り返し行の外にあります（${r + 1}行目）。この項目は空欄になります。`);
        break;
      }
    }
  }
  return out;
}
