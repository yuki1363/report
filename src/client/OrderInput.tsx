import { useEffect, useState } from 'react';
import { parseOrder } from '../domain/reorder.ts';

/** 順番の入力欄。数字を書き換えて Enter（または欄の外をクリック）すると、その位置へ移る。数字でなければ元に戻す */
export function OrderInput({ index, count, onMove }: { index: number; count: number; onMove: (to: number) => void }) {
  const [text, setText] = useState(String(index + 1));
  useEffect(() => setText(String(index + 1)), [index]); // 並びが変わったら、番号も追従
  const commit = () => {
    const to = parseOrder(text, count);
    if (to === undefined || to === index) setText(String(index + 1));
    else onMove(to);
  };
  return (
    <input
      className="order"
      inputMode="numeric"
      value={text}
      tabIndex={-1}
      title="順番。数字を書き換えて Enter で、その位置へ移動"
      aria-label={`${index + 1}番目の回路の順番`}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          setText(String(index + 1));
        }
        e.stopPropagation();
      }}
    />
  );
}
