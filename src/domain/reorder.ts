/** 配列の from 番目（0始まり）の要素を、to 番目の位置へ移す。範囲外・同じ位置なら、そのまま返す */
export function moveTo<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from === to || from < 0 || from >= out.length) return out;
  const t = Math.min(Math.max(to, 0), out.length - 1);
  const [item] = out.splice(from, 1);
  out.splice(t, 0, item!);
  return out;
}

/** 入力された順番（1始まり。全角も可）を、0始まりの位置にする。数字でなければ undefined。範囲外は端に丸める */
export function parseOrder(text: string, count: number): number | undefined {
  const t = text.normalize('NFKC').trim();
  if (!/^\d+$/.test(t)) return undefined;
  return Math.min(Math.max(Number(t), 1), count) - 1;
}

/**
 * 選んだ複数の要素（selected: 0始まりの位置）を、1つのかたまりにして to 番目（0始まり）へ移す。
 * かたまりの中の並びは、いまの並びのまま。to は「かたまりの先頭が来る位置」で、はみ出す分は末尾に合わせる。
 */
export function moveBlock<T>(list: readonly T[], selected: ReadonlySet<number>, to: number): T[] {
  const picked = list.filter((_, i) => selected.has(i));
  if (picked.length === 0) return [...list];
  const rest = list.filter((_, i) => !selected.has(i));
  const t = Math.min(Math.max(to, 0), rest.length);
  return [...rest.slice(0, t), ...picked, ...rest.slice(t)];
}
