import { describe, expect, it } from 'vitest';
import { moveBlock, moveTo, parseOrder } from './reorder.ts';

describe('回路の並び替え（順番の数字で移す）', () => {
  const l = ['a', 'b', 'c', 'd', 'e'];
  it('後ろへ移す: 2番目を4番目へ', () => expect(moveTo(l, 1, 3)).toEqual(['a', 'c', 'd', 'b', 'e']));
  it('前へ移す: 4番目を1番目へ', () => expect(moveTo(l, 3, 0)).toEqual(['d', 'a', 'b', 'c', 'e']));
  it('同じ位置・範囲外は変えない', () => {
    expect(moveTo(l, 2, 2)).toEqual(l);
    expect(moveTo(l, 9, 0)).toEqual(l);
  });
  it('元の配列は書き換えない', () => {
    moveTo(l, 0, 4);
    expect(l).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('順番の入力: 全角可・範囲外は端に丸める・数字以外は無効', () => {
    expect(parseOrder('3', 5)).toBe(2);
    expect(parseOrder(' ３ ', 5)).toBe(2);
    expect(parseOrder('0', 5)).toBe(0);
    expect(parseOrder('99', 5)).toBe(4);
    expect(parseOrder('', 5)).toBeUndefined();
    expect(parseOrder('a1', 5)).toBeUndefined();
  });
});

describe('選んだ複数行をまとめて移す', () => {
  const l = ['a', 'b', 'c', 'd', 'e', 'f'];
  it('先頭へ: c と e を1番目へ → c e a b d f（かたまりの中の順は変えない）', () => expect(moveBlock(l, new Set([2, 4]), 0)).toEqual(['c', 'e', 'a', 'b', 'd', 'f']));
  it('途中へ: a と b を4番目へ → c d e a b f（かたまりの先頭 a が4番目）', () => expect(moveBlock(l, new Set([0, 1]), 3)).toEqual(['c', 'd', 'e', 'a', 'b', 'f']));
  it('はみ出す指定は末尾に合わせる', () => expect(moveBlock(l, new Set([0, 2]), 99)).toEqual(['b', 'd', 'e', 'f', 'a', 'c']));
  it('選んでいなければ変えない・元の配列は書き換えない', () => {
    expect(moveBlock(l, new Set(), 2)).toEqual(l);
    expect(l).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});
