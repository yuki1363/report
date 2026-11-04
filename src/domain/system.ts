/** 電気方式・全角半角の正規化（OCR と貼り付け入力で共通）。純粋関数。 */
import type { WiringSystem } from '../shared/schema.ts';

export const toHalf = (s: string) =>
  s
    .replace(/[０-９Ａ-Ｚａ-ｚ．／（）]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');

/**
 * 電圧の入力を数値 [V] にする。
 * - 「105/210」「100/200V」のように2つ書かれている場合は大きい方（単相3線の線間電圧）を使う
 * - 全角、カンマ、末尾の V・ボルト は許す。数値にできなければ NaN、空なら undefined
 */
export function parseVoltage(input: string): number | undefined {
  const t = toHalf(input).replace(/[,\s]/g, '').replace(/(V|ボルト)$/i, '');
  if (t === '') return undefined;
  const parts = t.split(/[/／]/);
  if (parts.length > 2 || parts.some((x) => !/^\d+(\.\d+)?$/.test(x))) return NaN;
  return Math.max(...parts.map(Number));
}

/** 電圧の文字を、全角→半角・空白とカンマを除去・末尾の V（ボルト）を除去して整える */
export function normalizeVoltageText(input: string): string {
  return toHalf(input).replace(/[,\s]/g, '').replace(/(V|ボルト)$/i, '');
}

/** 「105/210」のように2つ書かれた電圧は、その表記（半角・Vなし）を返す。それ以外は undefined */
export function voltageLabel(input: string): string | undefined {
  const parts = toHalf(input).replace(/[,\s]/g, '').replace(/(V|ボルト)$/i, '').split('/');
  return parts.length === 2 && parts.every((x) => /^\d+(\.\d+)?$/.test(x)) ? `${parts[0]}/${parts[1]}` : undefined;
}

/** 電気方式の表記ゆれ（1Φ3W, 1P3W, 1ファイ3, 単相3線 等）を正規化する */
export function normalizeSystem(s: string): WiringSystem | null {
  const t = toHalf(s).replace(/\s/g, '');
  // 「1ファイ3」「1ふぁい3W」「1φ3」（W なし）など、読み方・省略の表記
  const kana = /([13])(?:ファイ|ふぁい|フィー|ぱい|パイ|φ|Φ)([234])(?:W|w|線)?(?![0-9])/.exec(t);
  if (kana) {
    const v = `${kana[1]}φ${kana[2]}W`;
    return (['1φ2W', '1φ3W', '3φ3W', '3φ4W'] as const).find((x) => x === v) ?? null;
  }
  // φ は OCR で「の」「ゅ」「ゆ」「9」「中」などに誤認されやすい
  const m = /([13])\s*(?:φ|Φ|ϕ|ψ|Ψ|P|p|ph|の|ゅ|ゆ|9|中|ф)\s*([234])\s*W/i.exec(t);
  if (m) {
    const v = `${m[1]}φ${m[2]}W`;
    return (['1φ2W', '1φ3W', '3φ3W', '3φ4W'] as const).find((x) => x === v) ?? null;
  }
  const j = /(単相|三相)([234二三四])線/.exec(t);
  if (j) {
    const n = { '2': '2', '3': '3', '4': '4', 二: '2', 三: '3', 四: '4' }[j[2] as '2'];
    const v = `${j[1] === '単相' ? 1 : 3}φ${n}W`;
    return (['1φ2W', '1φ3W', '3φ3W', '3φ4W'] as const).find((x) => x === v) ?? null;
  }
  return null;
}
