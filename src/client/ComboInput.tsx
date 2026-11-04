/**
 * 候補つきの入力欄。直接書くことも、候補から選ぶこともできる。
 * ブラウザ標準の候補表示（datalist）は、入っている文字に合う候補しか出さず、
 * 一度選ぶと文字を消さないと他の候補が出ないため、いつでも全部の候補を出すこの欄を使う。
 * 開き方: 欄をクリック、または右の「▼」。閉じ方: 候補を選ぶ・欄の外をクリック・Esc。
 */
import { useRef, useState, type InputHTMLAttributes } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'list'> {
  value: string;
  /** 候補（いつも全部を出す） */
  options: readonly string[];
  /** 文字を書いたとき */
  onChange: (text: string) => void;
  /** 候補から選んだとき（省略時は onChange と同じ） */
  onPick?: (text: string) => void;
  wrapClassName?: string;
}

export function ComboInput({ value, options, onChange, onPick, wrapClassName, onClick, onKeyDown, onBlur, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom, left: r.left, width: Math.max(r.width + 24, 96) });
  };
  const close = () => setPos(null);

  return (
    <span className={`combo ${wrapClassName ?? ''}`}>
      <input
        {...rest}
        ref={ref}
        value={value}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => {
          open();
          onClick?.(e);
        }}
        onBlur={(e) => {
          close();
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          // Alt+↓ または F4 で候補を開く（↑↓ だけは、表の行の移動に使うため開かない）
          if ((e.altKey && e.key === 'ArrowDown') || e.key === 'F4') {
            e.preventDefault();
            open();
          } else if (e.key === 'Enter') close();
          onKeyDown?.(e);
        }}
      />
      <button
        type="button"
        className="combo-btn"
        tabIndex={-1}
        title="候補を表示"
        aria-label="候補を表示"
        onMouseDown={(e) => {
          e.preventDefault(); // 欄から外れて閉じてしまわないように
          ref.current?.focus();
          if (pos) close();
          else open();
        }}
      >
        ▾
      </button>
      {pos && (
        <ul className="combo-pop" style={{ top: pos.top, left: pos.left, minWidth: pos.width }} role="listbox">
          {options.map((o) => (
            <li
              key={o}
              role="option"
              aria-selected={o === value}
              className={o === value ? 'on' : ''}
              onMouseDown={(e) => {
                e.preventDefault(); // 欄の確定（blur）より先に選ぶ
                (onPick ?? onChange)(o);
                close();
              }}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
