import { describe, expect, it } from 'vitest';
import { addGroup, flattenLayout, groupOf, moveGroup, moveToGroup, reconcileLayout, removeGroup, renameGroup, reorderInGroup, type Layout } from './layout.ts';

const L: Layout = { groups: [{ id: 'g1', name: '事務棟', ids: ['a', 'b', 'c'] }, { id: 'g2', name: '工場棟', ids: ['d'] }], ungrouped: ['x', 'y'] };

describe('報告書一覧のグループと並び', () => {
  it('整える: 無くなった報告書・重複を外し、新しい報告書は未分類の末尾へ', () => {
    const r = reconcileLayout(L, ['x', 'a', 'c', 'd', 'n1', 'n2', 'a']);
    expect(r).toEqual({ groups: [{ id: 'g1', name: '事務棟', ids: ['a', 'c'] }, { id: 'g2', name: '工場棟', ids: ['d'] }], ungrouped: ['x', 'n1', 'n2'] });
  });
  it('はじめ（空の並び）は、全部が未分類で、渡された順になる', () => {
    expect(reconcileLayout({ groups: [], ungrouped: [] }, ['p', 'q', 'r'])).toEqual({ groups: [], ungrouped: ['p', 'q', 'r'] });
  });
  it('表示の順: 未分類 → グループ順', () => expect(flattenLayout(L)).toEqual(['x', 'y', 'a', 'b', 'c', 'd']));
  it('グループの追加・名前変更', () => {
    const l = renameGroup(addGroup(L, 'g3', '屋外'), 'g3', '屋外（ガードハウス）');
    expect(l.groups.map((g) => g.name)).toEqual(['事務棟', '工場棟', '屋外（ガードハウス）']);
  });
  it('グループを消すと、中の報告書は未分類の末尾へ戻る（報告書は消えない）', () => {
    const l = removeGroup(L, 'g1');
    expect(l.groups.map((g) => g.id)).toEqual(['g2']);
    expect(l.ungrouped).toEqual(['x', 'y', 'a', 'b', 'c']);
  });
  it('グループの並び替え', () => expect(moveGroup(L, 1, 0).groups.map((g) => g.id)).toEqual(['g2', 'g1']));
  it('別のグループへ移す（複数・末尾）。元からは外れ、表示順を保つ', () => {
    const l = moveToGroup(L, ['c', 'a'], 'g2');
    expect(l.groups.find((g) => g.id === 'g1')!.ids).toEqual(['b']);
    expect(l.groups.find((g) => g.id === 'g2')!.ids).toEqual(['d', 'a', 'c']);
  });
  it('位置を指定して移す・未分類へ戻す', () => {
    expect(moveToGroup(L, ['x'], 'g2', 0).groups[1]!.ids).toEqual(['x', 'd']);
    const back = moveToGroup(L, ['d'], '');
    expect(back.ungrouped).toEqual(['x', 'y', 'd']);
    expect(back.groups[1]!.ids).toEqual([]);
  });
  it('存在しないグループへは移さない', () => expect(moveToGroup(L, ['x'], 'zzz')).toBe(L));
  it('グループの中で並び替え: a を3番目へ → b c a', () => expect(reorderInGroup(L, 'g1', ['a'], 2).groups[0]!.ids).toEqual(['b', 'c', 'a']));
  it('未分類の中でも並び替えできる', () => expect(reorderInGroup(L, '', ['y'], 0).ungrouped).toEqual(['y', 'x']));
  it('いま入っているグループ', () => {
    expect(groupOf(L, 'b')).toBe('g1');
    expect(groupOf(L, 'x')).toBe('');
    expect(groupOf(L, 'none')).toBeUndefined();
  });
});
