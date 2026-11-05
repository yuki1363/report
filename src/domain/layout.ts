/**
 * 報告書一覧の「自分で決めた並び」とグループ分け。
 * 報告書そのものには何も書き足さず、並びとグループだけを別に持つ（報告書の更新日時は変わらない）。
 */
import { z } from 'zod';
import { moveBlock } from './reorder.ts';

export const LayoutGroupSchema = z.object({ id: z.string().min(1), name: z.string(), ids: z.array(z.string()) });
export const LayoutSchema = z.object({
  /** 名前を付けたグループ（この並びのまま表示する） */
  groups: z.array(LayoutGroupSchema),
  /** どのグループにも入れていない報告書（「未分類」） */
  ungrouped: z.array(z.string()),
});
export type Layout = z.infer<typeof LayoutSchema>;
export type LayoutGroup = z.infer<typeof LayoutGroupSchema>;

/** 未分類を表すグループID */
export const UNGROUPED = '';
export const EMPTY_LAYOUT: Layout = { groups: [], ungrouped: [] };

/**
 * いま在る報告書に合わせて整える。無くなった報告書・重複は外し、どこにも入っていない報告書は、
 * existingIds の順で未分類の末尾に足す。
 */
export function reconcileLayout(layout: Layout, existingIds: readonly string[]): Layout {
  const exist = new Set(existingIds);
  const seen = new Set<string>();
  const keep = (ids: readonly string[]) =>
    ids.filter((id) => {
      if (!exist.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  const groups = layout.groups.map((g) => ({ ...g, ids: keep(g.ids) }));
  const ungrouped = keep(layout.ungrouped);
  for (const id of existingIds) if (!seen.has(id)) ungrouped.push(id), seen.add(id);
  return { groups, ungrouped };
}

/** 表示（印刷）の順: 未分類 → 各グループ（グループの並び順） */
export const flattenLayout = (layout: Layout): string[] => [...layout.ungrouped, ...layout.groups.flatMap((g) => g.ids)];

const without = (ids: readonly string[], drop: ReadonlySet<string>) => ids.filter((id) => !drop.has(id));

export function addGroup(layout: Layout, id: string, name: string): Layout {
  return { ...layout, groups: [...layout.groups, { id, name, ids: [] }] };
}

export function renameGroup(layout: Layout, id: string, name: string): Layout {
  return { ...layout, groups: layout.groups.map((g) => (g.id === id ? { ...g, name } : g)) };
}

/** グループを消す。中の報告書は消さず、未分類の末尾へ戻す */
export function removeGroup(layout: Layout, id: string): Layout {
  const g = layout.groups.find((x) => x.id === id);
  if (!g) return layout;
  return { groups: layout.groups.filter((x) => x.id !== id), ungrouped: [...layout.ungrouped, ...g.ids] };
}

/** グループ自体の並び替え（from・to は0始まり） */
export function moveGroup(layout: Layout, from: number, to: number): Layout {
  const groups = [...layout.groups];
  if (from === to || from < 0 || from >= groups.length) return layout;
  const [g] = groups.splice(from, 1);
  groups.splice(Math.min(Math.max(to, 0), groups.length), 0, g!);
  return { ...layout, groups };
}

/** 選んだ報告書を、指定のグループ（未分類は ''）へ移す。pos を指定すると、その位置（0始まり）へ入れる。なければ末尾 */
export function moveToGroup(layout: Layout, ids: readonly string[], groupId: string, pos?: number): Layout {
  const sel = new Set(ids);
  const base = { groups: layout.groups.map((g) => ({ ...g, ids: without(g.ids, sel) })), ungrouped: without(layout.ungrouped, sel) };
  // 選んだ順ではなく、いまの表示順を保つ
  const ordered = flattenLayout(layout).filter((id) => sel.has(id));
  const put = (list: string[]) => {
    const at = pos === undefined ? list.length : Math.min(Math.max(pos, 0), list.length);
    return [...list.slice(0, at), ...ordered, ...list.slice(at)];
  };
  if (groupId === UNGROUPED) return { ...base, ungrouped: put(base.ungrouped) };
  if (!base.groups.some((g) => g.id === groupId)) return layout;
  return { ...base, groups: base.groups.map((g) => (g.id === groupId ? { ...g, ids: put(g.ids) } : g)) };
}

/** 同じグループの中で、選んだ報告書をまとめて to 番目（0始まり）へ移す */
export function reorderInGroup(layout: Layout, groupId: string, ids: readonly string[], to: number): Layout {
  const sel = new Set(ids);
  const apply = (list: string[]) => moveBlock(list, new Set(list.flatMap((id, i) => (sel.has(id) ? [i] : []))), to);
  if (groupId === UNGROUPED) return { ...layout, ungrouped: apply(layout.ungrouped) };
  return { ...layout, groups: layout.groups.map((g) => (g.id === groupId ? { ...g, ids: apply(g.ids) } : g)) };
}

/** 報告書がいま入っているグループのID（未分類は ''。見つからなければ undefined） */
export function groupOf(layout: Layout, reportId: string): string | undefined {
  if (layout.ungrouped.includes(reportId)) return UNGROUPED;
  return layout.groups.find((g) => g.ids.includes(reportId))?.id;
}
