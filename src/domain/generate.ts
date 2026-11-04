/**
 * 自動作成: テンプレート（未展開の Sheet）＋報告書データ → 値が埋まった Sheet。
 * - repeatRegion を回路数ぶん複製する（以降の行・結合・画像・見出し行は下へずらす）
 * - "{{panel.name}}" "{{c.RE}}" などのバインドを文字列に置き換える
 * 純粋関数。
 */
import {
  DEFAULT_CRITERIA,
  READING_KEYS,
  READING_LABELS,
  type Cell,
  type Circuit,
  type Criteria,
  type Report,
  type Sheet,
} from '../shared/schema.ts';
import { judgeCircuit, judgePanel, VERDICT_LABEL } from './judgment.ts';
import { formatReading } from './reading.ts';

export interface BindingDef {
  key: string;
  label: string;
  scope: 'report' | 'circuit';
}

/** バインド項目の一覧（書式エディタの「バインド挿入」でも使う） */
export const BINDINGS: BindingDef[] = [
  { key: 'panel.name', label: '盤名', scope: 'report' },
  { key: 'panel.location', label: '設置場所', scope: 'report' },
  { key: 'report.date', label: '測定日', scope: 'report' },
  { key: 'report.inspector', label: '測定者', scope: 'report' },
  { key: 'report.tempC', label: '温度[℃]', scope: 'report' },
  { key: 'report.humidity', label: '湿度[%]', scope: 'report' },
  { key: 'report.note', label: '備考（報告書全体）', scope: 'report' },
  { key: 'report.judgment', label: '総合判定', scope: 'report' },
  { key: 'report.circuitCount', label: '回路数', scope: 'report' },
  { key: 'instrument.model', label: '測定器 型式', scope: 'report' },
  { key: 'instrument.serial', label: '測定器 製造番号', scope: 'report' },
  { key: 'instrument.calDate', label: '測定器 校正日', scope: 'report' },
  { key: 'c.index', label: '連番', scope: 'circuit' },
  { key: 'c.no', label: '回路No', scope: 'circuit' },
  { key: 'c.name', label: '回路名称', scope: 'circuit' },
  { key: 'c.system', label: '電気方式', scope: 'circuit' },
  { key: 'c.useVoltage', label: '使用電圧[V]', scope: 'circuit' },
  { key: 'c.groundVoltage', label: '対地電圧[V]', scope: 'circuit' },
  { key: 'c.testVoltage', label: '測定電圧[V]', scope: 'circuit' },
  { key: 'c.breakerA', label: 'ブレーカ容量[A]', scope: 'circuit' },
  ...READING_KEYS.map((k) => ({ key: `c.${k}`, label: `測定値 ${READING_LABELS[k]}`, scope: 'circuit' as const })),
  { key: 'c.min', label: '最小値[MΩ]', scope: 'circuit' },
  { key: 'c.criterion', label: '基準値[MΩ]', scope: 'circuit' },
  { key: 'c.judgment', label: '判定', scope: 'circuit' },
  { key: 'c.note', label: '備考', scope: 'circuit' },
];

const BIND_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

const str = (v: string | number | undefined | null): string => (v === undefined || v === null ? '' : String(v));

function reportValues(report: Report, criteria: Criteria): Record<string, string> {
  return {
    'panel.name': report.panel.name,
    'panel.location': str(report.panel.location),
    'report.date': report.date,
    'report.inspector': report.inspector,
    'report.tempC': str(report.tempC),
    'report.humidity': str(report.humidity),
    'report.note': str(report.note),
    'report.judgment': VERDICT_LABEL[judgePanel(report.circuits, criteria)],
    'report.circuitCount': String(report.circuits.length),
    'instrument.model': report.instrument.model,
    'instrument.serial': str(report.instrument.serial),
    'instrument.calDate': str(report.instrument.calDate),
  };
}

function circuitValues(c: Circuit, index: number, criteria: Criteria): Record<string, string> {
  const j = judgeCircuit(c, criteria);
  const v: Record<string, string> = {
    'c.index': String(index + 1),
    'c.no': c.no,
    'c.name': c.name,
    'c.system': c.system,
    'c.useVoltage': c.voltageLabel ?? String(c.useVoltage),
    'c.groundVoltage': String(c.groundVoltage),
    'c.testVoltage': String(c.testVoltage),
    'c.breakerA': str(c.breakerA),
    'c.min': formatReading(j.min),
    'c.criterion': String(j.criterion.mohm),
    'c.judgment': VERDICT_LABEL[j.verdict],
    'c.note': str(c.note),
  };
  for (const k of READING_KEYS) v[`c.${k}`] = formatReading(c.readings[k]);
  return v;
}

/** 文字列中のバインドを置換する。未知のキーはそのまま残す（テンプレートの誤りに気付けるように）。 */
export function resolveBindings(text: string, values: Record<string, string>): string {
  return text.replace(BIND_RE, (whole, key: string) => (key in values ? values[key]! : whole));
}

/** 回路行のバインドを空にした値（回路0件の時の空行に使う） */
function emptyCircuitValues(): Record<string, string> {
  const v: Record<string, string> = {};
  for (const b of BINDINGS) if (b.scope === 'circuit') v[b.key] = '';
  return v;
}

const key = (r: number, c: number) => `${r},${c}`;

export function parseKey(k: string): [number, number] {
  const [r, c] = k.split(',').map(Number);
  return [r!, c!];
}

/**
 * テンプレートを展開して、値が埋まった Sheet を返す。
 * 回路が0件の場合でも、繰り返し行は1回ぶん（空欄）出力する。
 */
export function generateSheet(template: Sheet, report: Report, criteria: Criteria = DEFAULT_CRITERIA): Sheet {
  const rv = reportValues(report, criteria);
  const region = template.repeatRegion;

  if (!region) {
    return mapCells(template, (cell) => resolveCell(cell, rv));
  }

  const { rowStart, rowEnd } = region;
  const h = rowEnd - rowStart + 1;
  const n = Math.max(1, report.circuits.length);
  const shift = (n - 1) * h;
  /** 元の行番号 → 展開後の行番号（繰り返し範囲より後ろの行用） */
  const shiftRow = (r: number) => (r > rowEnd ? r + shift : r);

  const rowHeightsMm: number[] = [];
  for (let r = 0; r < template.rowHeightsMm.length; r++) {
    if (r === rowStart) {
      for (let i = 0; i < n; i++) rowHeightsMm.push(...template.rowHeightsMm.slice(rowStart, rowEnd + 1));
      r = rowEnd;
    } else {
      rowHeightsMm.push(template.rowHeightsMm[r]!);
    }
  }

  const cells: Record<string, Cell> = {};
  for (const [k, cell] of Object.entries(template.cells)) {
    const [r, c] = parseKey(k);
    if (r >= rowStart && r <= rowEnd) {
      for (let i = 0; i < n; i++) {
        const circuit = report.circuits[i];
        const values = { ...rv, ...(circuit ? circuitValues(circuit, i, criteria) : emptyCircuitValues()) };
        cells[key(r + i * h, c)] = resolveCell(cell, values);
      }
    } else {
      cells[key(shiftRow(r), c)] = resolveCell(cell, rv);
    }
  }

  const merges: Sheet['merges'] = [];
  for (const m of template.merges) {
    if (m.r1 >= rowStart && m.r2 <= rowEnd) {
      for (let i = 0; i < n; i++) merges.push({ ...m, r1: m.r1 + i * h, r2: m.r2 + i * h });
    } else {
      // 繰り返し範囲をまたぐ結合は、終端だけを伸ばす
      merges.push({ ...m, r1: shiftRow(m.r1), r2: shiftRow(m.r2) });
    }
  }

  const images = template.images.map((im) => ({
    ...im,
    anchor: { ...im.anchor, r: shiftRow(im.anchor.r), r2: shiftRow(im.anchor.r2) },
  }));

  const rh = template.page.repeatHeaderRows;
  const page = { ...template.page, ...(rh ? { repeatHeaderRows: [shiftRow(rh[0]), shiftRow(rh[1])] as [number, number] } : {}) };

  return {
    page,
    colWidthsMm: [...template.colWidthsMm],
    rowHeightsMm,
    cells,
    merges,
    images,
    // 展開済みなので repeatRegion は持たない
  };
}

function resolveCell(cell: Cell, values: Record<string, string>): Cell {
  if (cell.value === undefined) return cell;
  return { ...cell, value: resolveBindings(cell.value, values) };
}

function mapCells(sheet: Sheet, fn: (c: Cell) => Cell): Sheet {
  const cells: Record<string, Cell> = {};
  for (const [k, c] of Object.entries(sheet.cells)) cells[k] = fn(c);
  return { ...sheet, cells };
}
