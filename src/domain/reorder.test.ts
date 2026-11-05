import { describe, expect, it } from 'vitest';
import { moveTo, parseOrder } from './reorder.ts';

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
