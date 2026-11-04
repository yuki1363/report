/**
 * 貼り付けた表（Excel などからコピーした文字）を回路の一覧にする。純粋関数。
 *
 * 列の順: 回路No ／ 回路名称 ／ 電気方式 ／ 使用電圧 ／ ブレーカ容量(AT)
 * - 区切りはタブ（Excel からのコピー）か、2つ以上の空白
 * - 電気方式・使用電圧が空欄または列が無い場合は、既定値（画面で指定）を使う
 * - 1行目が見出し（「No」「回路」「負荷」を含む）なら読み飛ばす
 */
import type { WiringSystem } from '../shared/schema.ts';
import { LOW_VOLTAGE_MAX_V } from './judgment.ts';
import { normalizeSystem, parseVoltage, toHalf, voltageLabel } from './system.ts';

export interface PastedCircuit {
  no: string;
  name: string;
  system: WiringSystem;
  useVoltage: number;
  /** 「105/210」のように書かれていたときの表記 */
  voltageLabel?: string;
  breakerA?: number;
  /** 既定値を使った項目（画面で薄く表示する） */
  defaulted: ('system' | 'useVoltage')[];
}

export interface PasteResult {
  circuits: PastedCircuit[];
  /** 取り込めなかった行（行番号は貼り付けた文字の何行目か） */
  errors: { line: number; text: string; reason: string }[];
  skippedHeader: boolean;
}

export interface PasteDefaults {
  system: WiringSystem;
  useVoltage: number;
}

const HEADER_RE = /^(No\.?|回路|負荷|ELB|MCB|番号)/i;

function splitLine(line: string): string[] {
  const cells = line.includes('\t') ? line.split('\t') : line.trim().split(/\s{2,}|　+/);
  return cells.map((c) => c.trim());
}

const toNumber = (s: string): number | undefined => {
  const t = toHalf(s).replace(/[,\s]/g, '').replace(/(V|A|AT|ボルト|アンペア)$/i, '');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

export function parsePastedCircuits(text: string, defaults: PasteDefaults): PasteResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const result: PasteResult = { circuits: [], errors: [], skippedHeader: false };
  let first = true;
  lines.forEach((raw, idx) => {
    if (!raw.trim()) return;
    const cells = splitLine(raw);
    if (first) {
      first = false;
      if (HEADER_RE.test(cells[0] ?? '') || /回路名称|負荷名称/.test(raw)) {
        result.skippedHeader = true;
        return;
      }
    }
    // 回路名称の1列だけが貼られた場合（番号なし）は、番号を自動で振る
    const onlyName = cells.length === 1;
    const no = onlyName ? String(result.circuits.length + 1) : (cells[0] ?? '');
    const name = onlyName ? (cells[0] ?? '') : (cells[1] ?? '');
    const sysText = cells[2] ?? '';
    const system = sysText ? normalizeSystem(sysText) : defaults.system;
    const voltText = cells[3] ?? '';
    const volt = voltText ? parseVoltage(voltText) : defaults.useVoltage;
    const at = cells[4] ? toNumber(cells[4]) : undefined;
    const fail = (reason: string) => result.errors.push({ line: idx + 1, text: raw.trim(), reason });
    if (!name && !no) return fail('回路No・回路名称が空です');
    if (system === null) return fail(`電気方式「${sysText}」を判別できません（1φ2W / 1φ3W / 3φ3W / 3φ4W）`);
    if (volt === undefined || Number.isNaN(volt) || volt <= 0) return fail(`使用電圧「${voltText}」が数値ではありません`);
    if (volt > LOW_VOLTAGE_MAX_V) return fail(`使用電圧 ${volt}V は低圧（${LOW_VOLTAGE_MAX_V}V 以下）の範囲外です`);
    if (at !== undefined && (Number.isNaN(at) || at < 0)) return fail(`ブレーカ容量「${cells[4]}」が数値ではありません`);
    result.circuits.push({
      no,
      name,
      system,
      useVoltage: volt,
      ...(voltText && voltageLabel(voltText) ? { voltageLabel: voltageLabel(voltText)! } : {}),
      ...(at !== undefined ? { breakerA: at } : {}),
      defaulted: [...(sysText ? [] : (['system'] as const)), ...(voltText ? [] : (['useVoltage'] as const))],
    });
  });
  return result;
}
