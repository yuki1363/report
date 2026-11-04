/**
 * 既定テンプレート templates/default.json を生成する。
 *   npm run gen:template
 * A4 縦、余白 上下10mm・左右8mm、印字幅 194mm。
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { READING_KEYS, READING_LABELS, TemplateSchema, type Cell, type CellStyle, type Sheet } from '../src/shared/schema.ts';

const cols = [
  39, // 0 回路名称（回路No の列は載せない。空いた幅を回路名称に）
  10, // 1 種別（ELB・MCB・Mg など）
  10, // 2 容量[A]
  12, // 3 電気方式
  13, // 4 使用電圧（「105/210」の表記が入る）
  9.5, 9.5, 9.5, 9.5, 9.5, 9.5, 9.5, 9.5, // 5-12 測定値
  10, // 13 基準値
  9, // 14 判定
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
const H: CellStyle = { hAlign: 'center', bold: true, fill: '#EEEEEE', wrap: true, sizePt: 7 };
boxed(6, 0, 7, 0, '回路名称', H);
boxed(6, 1, 7, 1, '種別', H);
boxed(6, 2, 7, 2, '容量\n[A]', H);
boxed(6, 3, 7, 3, '電気\n方式', H);
boxed(6, 4, 7, 4, '使用\n電圧\n[V]', H);
boxed(6, 5, 6, 12, '絶縁抵抗値 [MΩ]', H);
READING_KEYS.forEach((k, i) => boxed(7, 5 + i, 7, 5 + i, READING_LABELS[k], H));
boxed(6, 13, 7, 13, '基準値\n[MΩ]', H);
boxed(6, 14, 7, 14, '判定', H);
boxed(6, 15, 7, 15, '備考', H);

// 8: 回路行（回路数ぶん繰り返す）。回路No・最小値の列は載せない
rows.push(7);
const C: CellStyle = { border: all, sizePt: 8 };
set(8, 0, '{{c.name}}', { ...C, shrinkToFit: true });
set(8, 1, '{{c.deviceType}}', { ...C, hAlign: 'center', shrinkToFit: true });
set(8, 2, '{{c.breakerA}}', { ...C, hAlign: 'right', shrinkToFit: true });
set(8, 3, '{{c.system}}', { ...C, hAlign: 'center' });
set(8, 4, '{{c.useVoltage}}', { ...C, hAlign: 'right', shrinkToFit: true });
READING_KEYS.forEach((k, i) => set(8, 5 + i, `{{c.${k}}}`, { ...C, hAlign: 'right', shrinkToFit: true }));
set(8, 13, '{{c.criterion}}', { ...C, hAlign: 'right' });
set(8, 14, '{{c.judgment}}', { ...C, hAlign: 'center', bold: true });
set(8, 15, '{{c.note}}', { ...C, shrinkToFit: true });

// 9: 余白
rows.push(4);
// 10-12: 備考欄（大きめ。総合判定は載せない）
rows.push(10, 10, 10);
boxed(10, 0, 12, 1, '備考', { hAlign: 'center', bold: true, fill: '#EEEEEE', sizePt: 10 });
boxed(10, 2, 12, LAST, '{{report.note}}', { sizePt: 9, wrap: true, vAlign: 'top' });
// 13: 余白
rows.push(3);
// 14-15: 注記
rows.push(8, 5); // 注記1は2行に折り返す
set(14, 0, '判定基準：電気設備技術基準 第58条（使用電圧300V以下かつ対地電圧150V以下：0.1MΩ以上／300V以下でその他：0.2MΩ以上／300V超：0.4MΩ以上）', { sizePt: 7, wrap: true, vAlign: 'top' });
merge(14, 0, 14, LAST);
set(15, 0, '測定値の表記：「>2000」は測定範囲上限超過、「-」は測定対象外を示す。判定は各回路の測定値の最小値で行う。', { sizePt: 7 });
merge(15, 0, 15, LAST);

const sheet: Sheet = {
  page: { size: 'A4', orientation: 'portrait', marginsMm: { t: 10, r: 8, b: 10, l: 8 }, repeatHeaderRows: [6, 7] },
  colWidthsMm: cols,
  rowHeightsMm: rows,
  cells,
  merges,
  repeatRegion: { rowStart: 8, rowEnd: 8, source: 'circuits' },
  images: [],
};

const template = TemplateSchema.parse({ id: 'default', name: '標準（A4縦）', sheet });
const out = fileURLToPath(new URL('../templates/default.json', import.meta.url));
writeFileSync(out, JSON.stringify(template, null, 1) + '\n');
console.log(`wrote ${out}: ${rows.length} rows x ${cols.length} cols, width ${cols.reduce((a, b) => a + b, 0)}mm`);
