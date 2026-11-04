/** 測定値の入力文字列 ⇄ Reading の変換（キーボード入力用）。純粋関数。 */
import type { Reading } from '../shared/schema.ts';

/**
 * 入力文字列を Reading に変換する（全角数字も可）。
 * - ""                          → undefined（未入力）
 * - "-" / "na" / "/"            → { kind:'na' }（測定対象外）
 * - ">2000" / "2000<" / "2000以上" → { kind:'over', mohm:2000 }（上限超過。上限値の数値が必須）
 * - "0.12"                      → { kind:'value', mohm:0.12 }
 * 解釈できない場合は null を返す（入力エラー）。
 */
export function parseReading(input: string): Reading | undefined | null {
  const s = input.trim().replace(/[０-９．]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  if (s === '') return undefined;
  if (/^(-|－|ー|na|NA|\/|／)$/.test(s)) return { kind: 'na' };
  const over = /^(?:>|＞|≧|>=)\s*(\d+(?:\.\d+)?)$/.exec(s) ?? /^(\d+(?:\.\d+)?)\s*(?:<|＜|以上|\+)$/.exec(s);
  if (over) return { kind: 'over', mohm: Number(over[1]) };
  if (/^\d+(?:\.\d+)?$/.test(s) || /^\.\d+$/.test(s)) return { kind: 'value', mohm: Number(s) };
  return null;
}

/** Reading を表示・入力用文字列にする。 */
export function formatReading(r: Reading | undefined): string {
  if (!r) return '';
  switch (r.kind) {
    case 'value':
      return String(r.mohm);
    case 'over':
      return `>${r.mohm}`;
    case 'na':
      return '-';
  }
}
