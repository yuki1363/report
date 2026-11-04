/**
 * Sheet（展開済み）→ 印刷用 HTML。
 * PDF 出力（Edge の page.pdf）と画面プレビューの両方でこの HTML をそのまま使う（見た目のずれ防止）。
 * 純粋関数（DOM 非依存）。
 */
import type { BorderStyle, Cell, Sheet } from '../shared/schema.ts';
import { parseKey } from './generate.ts';

export const PAPER_MM: Record<'A4' | 'A3', { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
};

/** 既定フォント。Windows 標準フォントを優先し、他 OS 用の代替を後ろに並べる。 */
export const DEFAULT_FONT_STACK =
  '"BIZ UDGothic", "BIZ UDゴシック", "Yu Gothic Medium", "Meiryo", "MS Gothic", "IPAGothic", "Noto Sans CJK JP", sans-serif';
export const DEFAULT_FONT_PT = 9;

const BORDER_CSS: Record<BorderStyle, string> = {
  thin: '0.5pt solid #000',
  medium: '1pt solid #000',
  thick: '1.75pt solid #000',
  double: '2.5pt double #000',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** 用紙の印字可能幅・高さ [mm] */
export function printableArea(sheet: Sheet): { w: number; h: number } {
  const p = PAPER_MM[sheet.page.size];
  const [w, h] = sheet.page.orientation === 'landscape' ? [p.h, p.w] : [p.w, p.h];
  const m = sheet.page.marginsMm;
  return { w: w - m.l - m.r, h: h - m.t - m.b };
}

export function sheetWidthMm(sheet: Sheet): number {
  return sheet.colWidthsMm.reduce((a, b) => a + b, 0);
}

/** 用紙幅からはみ出していないかの確認（UI の警告表示用） */
export function widthOverflowMm(sheet: Sheet): number {
  return Math.max(0, Math.round((sheetWidthMm(sheet) - printableArea(sheet).w) * 10) / 10);
}

/** 簡易 numFmt: "0" "0.0" "0.00" … の小数桁指定のみ対応。数値でない値はそのまま。 */
export function applyNumFmt(value: string, numFmt?: string): string {
  if (!numFmt) return value;
  const m = /^0(?:\.(0+))?$/.exec(numFmt);
  if (!m || !/^-?\d+(?:\.\d+)?$/.test(value)) return value;
  return Number(value).toFixed(m[1]?.length ?? 0);
}

function cellCss(cell: Cell | undefined): { td: string; div: string } {
  const s = cell?.style ?? {};
  const td: string[] = [];
  const div: string[] = [];
  if (s.fill) td.push(`background:${s.fill}`);
  if (s.border?.t) td.push(`border-top:${BORDER_CSS[s.border.t]}`);
  if (s.border?.r) td.push(`border-right:${BORDER_CSS[s.border.r]}`);
  if (s.border?.b) td.push(`border-bottom:${BORDER_CSS[s.border.b]}`);
  if (s.border?.l) td.push(`border-left:${BORDER_CSS[s.border.l]}`);
  if (s.font) div.push(`font-family:"${s.font.replace(/"/g, '')}", ${DEFAULT_FONT_STACK}`);
  if (s.sizePt) div.push(`font-size:${s.sizePt}pt`);
  if (s.bold) div.push('font-weight:bold');
  const h = s.hAlign ?? 'left';
  div.push(`justify-content:${h === 'left' ? 'flex-start' : h === 'right' ? 'flex-end' : 'center'}`);
  div.push(`text-align:${h}`);
  const v = s.vAlign ?? 'middle';
  div.push(`align-items:${v === 'top' ? 'flex-start' : v === 'bottom' ? 'flex-end' : 'center'}`);
  div.push(s.wrap ? 'white-space:pre-wrap;word-break:break-all' : 'white-space:pre');
  return { td: td.join(';'), div: div.join(';') };
}

/** 帳票 HTML 一式を返す。 */
export function renderSheetHtml(sheet: Sheet, opts: { title?: string } = {}): string {
  const rows = sheet.rowHeightsMm.length;
  const cols = sheet.colWidthsMm.length;
  const { page } = sheet;
  const m = page.marginsMm;

  // 結合: 左上セル → 範囲、その他の被覆セル → スキップ
  const mergeAt = new Map<string, { rs: number; cs: number }>();
  const covered = new Set<string>();
  for (const mg of sheet.merges) {
    mergeAt.set(`${mg.r1},${mg.c1}`, { rs: mg.r2 - mg.r1 + 1, cs: mg.c2 - mg.c1 + 1 });
    for (let r = mg.r1; r <= mg.r2; r++)
      for (let c = mg.c1; c <= mg.c2; c++) if (r !== mg.r1 || c !== mg.c1) covered.add(`${r},${c}`);
  }

  const renderRow = (r: number): string => {
    const tds: string[] = [];
    for (let c = 0; c < cols; c++) {
      const k = `${r},${c}`;
      if (covered.has(k)) continue;
      const cell = sheet.cells[k];
      const span = mergeAt.get(k);
      const css = cellCss(cell);
      const text = escapeHtml(applyNumFmt(cell?.value ?? '', cell?.numFmt));
      const attrs = [
        span && span.rs > 1 ? `rowspan="${span.rs}"` : '',
        span && span.cs > 1 ? `colspan="${span.cs}"` : '',
        css.td ? `style="${css.td}"` : '',
      ]
        .filter(Boolean)
        .join(' ');
      const shrink = cell?.style?.shrinkToFit ? ' data-shrink="1"' : '';
      tds.push(`<td${attrs ? ' ' + attrs : ''}><div class="c" style="${css.div}"${shrink}>${text}</div></td>`);
    }
    return `<tr style="height:${sheet.rowHeightsMm[r]}mm">${tds.join('')}</tr>`;
  };

  const rowRange = (a: number, b: number) => {
    const out: string[] = [];
    for (let r = a; r <= b; r++) out.push(renderRow(r));
    return out.join('\n');
  };

  const colgroup = `<colgroup>${sheet.colWidthsMm.map((w) => `<col style="width:${w}mm">`).join('')}</colgroup>`;
  const tableStyle = `width:${sheetWidthMm(sheet)}mm`;

  // 見出し行の繰り返し: 見出し行の前／見出し行(thead)／本体 に分ける。
  // 境界をまたぐ結合がある場合は分割できないため、繰り返しなしで描画する。
  let body: string;
  const rh = page.repeatHeaderRows;
  const crosses = (boundary: number) => sheet.merges.some((mg) => mg.r1 < boundary && mg.r2 >= boundary);
  if (rh && !crosses(rh[0]) && !crosses(rh[1] + 1)) {
    const [a, b] = rh;
    const pre = a > 0 ? `<table style="${tableStyle}">${colgroup}<tbody>${rowRange(0, a - 1)}</tbody></table>` : '';
    body =
      pre +
      `<table style="${tableStyle}">${colgroup}<thead>${rowRange(a, b)}</thead><tbody>${rowRange(b + 1, rows - 1)}</tbody></table>`;
  } else {
    body = `<table style="${tableStyle}">${colgroup}<tbody>${rowRange(0, rows - 1)}</tbody></table>`;
  }

  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<title>${escapeHtml(opts.title ?? '絶縁抵抗測定報告書')}</title>
<style>
@page { size: ${page.size} ${page.orientation}; margin: ${m.t}mm ${m.r}mm ${m.b}mm ${m.l}mm; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { font-family: ${DEFAULT_FONT_STACK}; font-size: ${DEFAULT_FONT_PT}pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
table { border-collapse: collapse; table-layout: fixed; border-spacing: 0; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
td { position: relative; padding: 0; overflow: hidden; vertical-align: middle; }
td > .c { position: absolute; inset: 0; padding: 0 0.8mm; display: flex; overflow: hidden; line-height: 1.15; }
@media screen {
  body { background: #e5e7eb; padding: 12px; }
  .sheet { background: #fff; margin: 0 auto; padding: ${m.t}mm ${m.r}mm ${m.b}mm ${m.l}mm; box-shadow: 0 1px 4px rgba(0,0,0,.3); width: fit-content; }
}
</style></head>
<body><div class="sheet">
${body}
</div>
<script>
// 縮小して全体を表示（shrinkToFit）: はみ出す間フォントを小さくする
for (const el of document.querySelectorAll('[data-shrink]')) {
  let pt = parseFloat(getComputedStyle(el).fontSize) * 0.75;
  while ((el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight) && pt > 4) {
    pt -= 0.25; el.style.fontSize = pt + 'pt';
  }
}
</script>
</body></html>`;
}
