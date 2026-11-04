/**
 * 貼り付けた表（Excel などからコピーした文字）を回路の一覧にする。純粋関数。
 *
 * 列の順（帳票の列の順）: 回路No ／ 回路名称 ／ 種別（ELB・MCB・Mg など） ／ 容量[A] ／ 電気方式 ／ 使用電圧
 * - 区切りはタブ（Excel からのコピー）か、2つ以上の空白
 * - 使用電圧は自由に書ける（4パターン以外も、書いたとおりに帳票へ出す。数字として読めることが必要）
 * - 電気方式と使用電圧は連動する（1φ2W=105 ／ 1φ3W=105/210 ／ 3φ3W=210 か 440）
 *   - 電圧が4パターンのどれかで電気方式が空欄なら、電気方式が決まる。電気方式だけなら、電圧が決まる
 *   - 両方書かれていれば、組み合わせが合わなくても書いたとおりに取り込む
 *   - どちらも空欄・列なしなら、既定の電圧（画面で指定）から決まる。既定が「空欄」なら、電気方式も電圧も空欄
 * - 1行目が見出し（「No」「回路」「負荷」を含む）なら読み飛ばす
 */
import { SELECTABLE_SYSTEMS, type WiringSystem } from '../shared/schema.ts';
import { LOW_VOLTAGE_MAX_V } from './judgment.ts';
import { normalizeSystem, normalizeVoltageText, parseVoltage, toHalf } from './system.ts';
import { patternForSystem, patternOfText, SYSTEM_OF_PATTERN, VOLTAGE_PATTERNS, type VoltagePattern } from './voltagePattern.ts';

export interface PastedCircuit {
  no: string;
  name: string;
  /** 空欄（''）のときは、使用電圧も空欄（0） */
  system: WiringSystem | '';
  deviceType?: string;
  useVoltage: number;
  /** 「105/210」のように、帳票に出す電圧の表記 */
  voltageLabel?: string;
  breakerA?: number;
  /** 既定値（または連動）で決めた項目（画面で薄く表示する） */
  defaulted: ('system' | 'useVoltage')[];
}

export interface PasteResult {
  circuits: PastedCircuit[];
  /** 取り込めなかった行（行番号は貼り付けた文字の何行目か） */
  errors: { line: number; text: string; reason: string }[];
  skippedHeader: boolean;
}

export interface PasteDefaults {
  /** 既定の電圧パターン（105 / 105/210 / 210 / 440）。'' なら空欄（電気方式も空欄） */
  voltage: string;
}

const SYSTEM_TEXT = SELECTABLE_SYSTEMS.join(' / ');
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
  const defaultPattern: VoltagePattern | undefined = defaults.voltage === '' ? undefined : (VOLTAGE_PATTERNS.find((p) => p.value === defaults.voltage) ?? VOLTAGE_PATTERNS[2]!);
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
    const fail = (reason: string) => result.errors.push({ line: idx + 1, text: raw.trim(), reason });
    // 回路名称の1列だけが貼られた場合（番号なし）は、番号を自動で振る
    // ただし、数字だけの行（例: 72）は回路No として扱い、名称は空欄にする
    const onlyOne = cells.length === 1;
    const onlyNo = onlyOne && /^\d+(-\d+)?$/.test(cells[0] ?? '');
    const onlyName = onlyOne && !onlyNo;
    const no = onlyName ? String(result.circuits.length + 1) : (cells[0] ?? '');
    const name = onlyName ? (cells[0] ?? '') : (cells[1] ?? '');
    if (!name && !no) return fail('回路No・回路名称が空です');

    const deviceType = (cells[2] ?? '').trim();
    const at = cells[3] ? toNumber(cells[3]) : undefined;
    const sysText = cells[4] ?? '';
    const voltText = cells[5] ?? '';

    // 電気方式
    let system: WiringSystem | '' | undefined;
    if (sysText) {
      const s = normalizeSystem(sysText);
      if (s === null || !(SELECTABLE_SYSTEMS as readonly string[]).includes(s)) {
        return fail(`電気方式「${sysText}」は使えません（${SYSTEM_TEXT}）`);
      }
      system = s;
    }
    // 使用電圧
    let pattern: VoltagePattern | undefined;
    let free: { useVoltage: number; label?: string } | undefined; // 4パターン以外で、自由に書かれた電圧
    if (voltText) {
      const v = parseVoltage(voltText);
      if (v === undefined || Number.isNaN(v) || v <= 0) return fail(`使用電圧「${voltText}」が数値ではありません`);
      if (v > LOW_VOLTAGE_MAX_V) return fail(`使用電圧 ${v}V は低圧（${LOW_VOLTAGE_MAX_V}V 以下）の範囲外です`);
      pattern = patternOfText(voltText);
      if (!pattern) {
        const t = normalizeVoltageText(voltText);
        free = { useVoltage: v, ...(String(v) === t ? {} : { label: t }) }; // 書いたとおりに残す
      }
    }
    // 連動
    if (free) {
      // 自由な電圧: 電気方式は書かれていればそれ、無ければ空欄のまま（勝手に決めない）
      if (system === undefined) system = '';
    } else if (system && pattern) {
      // 方式も電圧も書かれていれば、組み合わせが合わなくても書いたとおりに取り込む
    } else if (system) {
      pattern = patternForSystem(system, defaultPattern); // 方式だけ → 既定の電圧が合えばそれ、合わなければ方式の既定
    } else if (pattern) {
      system = SYSTEM_OF_PATTERN[pattern.value]!; // 電圧だけ → 方式が決まる
    } else if (defaultPattern) {
      pattern = defaultPattern; // どちらも空欄 → 既定の電圧から
      system = SYSTEM_OF_PATTERN[pattern.value]!;
    } else {
      system = ''; // 既定も空欄 → 電気方式も電圧も空欄
    }
    if (at !== undefined && (Number.isNaN(at) || at < 0)) return fail(`容量「${cells[3]}」が数値ではありません`);

    result.circuits.push({
      no,
      name,
      system: system ?? '',
      ...(deviceType ? { deviceType } : {}),
      useVoltage: free?.useVoltage ?? pattern?.useVoltage ?? 0,
      ...((free?.label ?? pattern?.label) ? { voltageLabel: (free?.label ?? pattern?.label)! } : {}),
      ...(at !== undefined ? { breakerA: at } : {}),
      defaulted: [...(sysText ? [] : (['system'] as const)), ...(voltText ? [] : (['useVoltage'] as const))],
    });
  });
  return result;
}
