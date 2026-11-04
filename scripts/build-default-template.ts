/**
 * 既定テンプレート templates/default.json を生成する。
 *   npm run gen:template
 * A4 横、余白 10mm、印字幅 277mm。
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { READING_KEYS, READING_LABELS, TemplateSchema, type Cell, type CellStyle, type Sheet } from '../src/shared/schema.ts';

const cols = [
  10, // 0 No
  76, // 1 回路名称
  16, // 2 電気方式
  14, // 3 使用電圧
  13, 13, 13, 13, 13, 13, 13, 13, // 4-11 測定値
  16, // 12 最小値
  14, // 13 基準値
  12, // 14 判定
  15, // 15 備考
];
const LAST = cols.length - 1;

const rows: number[] = [];
const cells: Record<string, Cell> = {};
const merges: Sheet['merges'] = [];

const all = { t: 'thin', r: 'thin', b: 'thin', l: 'thin' } as const;
const set = (r: number, c: number, value: string, style: CellStyle = {}, numFmt?: string) => {
  cells[`${r},${c}`] = { value, style, ...(numFmt ? { numFmt } : {}) };
};
const merge = (r1: number, c1: number, r2: number, c2: number) => merges.push({ r1, c1, r2, c2 });
/** 結合範囲すべてに同じ罫線を付ける（Excel 出力で外周の罫線が欠けないように） */
const boxed = (r1: number, c1: number, r2: number, c2: number, value: string, style: CellStyle = {}) => {
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) set(r, c, '', { ...style, border: all });
  set(r1, c1, value, { ...style, border: all });
  if (r1 !== r2 || c1 !== c2) merge(r1, c1, r2, c2);
};

// 0: タイトル
rows.push(12);
set(0, 0, '絶縁抵抗測定報告書', { sizePt: 16, bold: true, hAlign: 'center' });
merge(0, 0, 0, LAST);
// 1: 余白
rows.push(3);
// 2-4: 基本情報（測定者・測定器は帳票に載せない。測定日は空欄でも可）
const info = (r: number, items: [string, string]) => {
  rows.push(7);
  const ranges: [number, number][] = [
    [0, 7],
    [8, LAST],
  ];
  ranges.forEach(([c1, c2], i) => {
    for (let c = c1; c <= c2; c++) set(r, c, '', { border: { b: 'thin' } });
    set(r, c1, items[i]!, { sizePt: 10, border: { b: 'thin' }, shrinkToFit: true });
    merge(r, c1, r, c2);
  });
};
info(2, ['盤名：{{panel.name}}', '測定日：{{report.date}}']);
info(3, ['設置場所：{{panel.location}}', '温度：{{report.tempC}} ℃　湿度：{{report.humidity}} %']);
info(4, ['回路数：{{report.circuitCount}}', '']);
// 5: 余白
rows.push(4);

// 6-7: 表の見出し（2段）
rows.push(6, 6);
const H: CellStyle = { hAlign: 'center', bold: true, fill: '#EEEEEE', wrap: true, sizePt: 8 };
boxed(6, 0, 7, 0, 'No', H);
boxed(6, 1, 7, 1, '回路名称', H);
boxed(6, 2, 7, 2, '電気方式', H);
boxed(6, 3, 7, 3, '使用電圧\n[V]', H);
boxed(6, 4, 6, 11, '絶縁抵抗値 [MΩ]', H);
READING_KEYS.forEach((k, i) => boxed(7, 4 + i, 7, 4 + i, READING_LABELS[k], H));
boxed(6, 12, 7, 12, '最小値\n[MΩ]', H);
boxed(6, 13, 7, 13, '基準値\n[MΩ]', H);
boxed(6, 14, 7, 14, '判定', H);
boxed(6, 15, 7, 15, '備考', H);

// 8: 回路行（回路数ぶん繰り返す）
rows.push(7);
const C: CellStyle = { border: all, sizePt: 9 };
set(8, 0, '{{c.no}}', { ...C, hAlign: 'center' });
set(8, 1, '{{c.name}}', { ...C, shrinkToFit: true });
set(8, 2, '{{c.system}}', { ...C, hAlign: 'center' });
set(8, 3, '{{c.useVoltage}}', { ...C, hAlign: 'right' });
READING_KEYS.forEach((k, i) => set(8, 4 + i, `{{c.${k}}}`, { ...C, hAlign: 'right', shrinkToFit: true }));
set(8, 12, '{{c.min}}', { ...C, hAlign: 'right', shrinkToFit: true });
set(8, 13, '{{c.criterion}}', { ...C, hAlign: 'right' });
set(8, 14, '{{c.judgment}}', { ...C, hAlign: 'center', bold: true });
set(8, 15, '{{c.note}}', { ...C, shrinkToFit: true });

// 9: 余白
rows.push(4);
// 10: 総合判定
rows.push(8);
boxed(10, 0, 10, 2, '総合判定', { hAlign: 'center', bold: true, fill: '#EEEEEE', sizePt: 10 });
boxed(10, 3, 10, 5, '{{report.judgment}}', { hAlign: 'center', bold: true, sizePt: 12 });
// 11-12: 注記
rows.push(5, 5);
set(11, 0, '判定基準：電気設備技術基準 第58条（使用電圧300V以下かつ対地電圧150V以下：0.1MΩ以上／300V以下でその他：0.2MΩ以上／300V超：0.4MΩ以上）', { sizePt: 7 });
merge(11, 0, 11, LAST);
set(12, 0, '測定値の表記：「>2000」は測定範囲上限超過、「-」は測定対象外を示す。判定は各回路の測定値の最小値で行う。', { sizePt: 7 });
merge(12, 0, 12, LAST);

const sheet: Sheet = {
  page: { size: 'A4', orientation: 'landscape', marginsMm: { t: 10, r: 10, b: 10, l: 10 }, repeatHeaderRows: [6, 7] },
  colWidthsMm: cols,
  rowHeightsMm: rows,
  cells,
  merges,
  repeatRegion: { rowStart: 8, rowEnd: 8, source: 'circuits' },
  images: [],
};

const template = TemplateSchema.parse({ id: 'default', name: '標準（A4横）', sheet });
const out = fileURLToPath(new URL('../templates/default.json', import.meta.url));
writeFileSync(out, JSON.stringify(template, null, 1) + '\n');
console.log(`wrote ${out}: ${rows.length} rows x ${cols.length} cols, width ${cols.reduce((a, b) => a + b, 0)}mm`);
