/** 電気方式・全角半角の正規化（OCR と貼り付け入力で共通）。純粋関数。 */
import type { WiringSystem } from '../shared/schema.ts';

export const toHalf = (s: string) =>
  s
    .replace(/[０-９Ａ-Ｚａ-ｚ．／（）]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');

/** 電気方式の表記ゆれ（1Φ3W, 1P3W, 単相3線 等）を正規化する */
export function normalizeSystem(s: string): WiringSystem | null {
  const t = toHalf(s).replace(/\s/g, '');
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
