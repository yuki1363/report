import { useEffect, useMemo, useState } from 'react';
import { addGroup, EMPTY_LAYOUT, flattenLayout, groupOf, moveGroup, moveToGroup, removeGroup, renameGroup, reorderInGroup, UNGROUPED, type Layout } from '../../domain/layout.ts';
import { parseOrder } from '../../domain/reorder.ts';
import type { ReportSummary } from '../../shared/schema.ts';
import { api } from '../api.ts';
import { navigate } from '../nav.ts';
import { OrderInput } from '../OrderInput.tsx';

type SortKey = 'manual' | 'updated' | 'name' | 'date';
const SORT_LABEL: Record<SortKey, string> = { manual: '自分で決めた順（グループ）', updated: '更新が新しい順', name: '盤名順', date: '測定日が新しい順' };

/** 盤名の自然順（「No.2」の次が「No.10」になるように数字は数として比べる） */
const byName = (a: ReportSummary, b: ReportSummary) => a.panelName.localeCompare(b.panelName, 'ja', { numeric: true });

export function ReportList() {
  const [items, setItems] = useState<ReportSummary[] | null>(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<SortKey>('manual');
  const [layout, setLayout] = useState<Layout>(EMPTY_LAYOUT);
  const [moveTarget, setMoveTarget] = useState<string>(UNGROUPED);
  const [moveNo, setMoveNo] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');

  const load = () =>
    Promise.all([api.listReports(), api.getLayout()])
      .then(([list, lay]) => {
        setItems(list);
        setLayout(lay);
        // 削除などで無くなった報告書の選択は外す
        setSelected((sel) => new Set([...sel].filter((id) => list.some((r) => r.id === id))));
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => void load(), []);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** 並び・グループを変える（すぐ画面に反映し、サーバーへ保存。失敗したら読み直す） */
  const change = (fn: (l: Layout) => Layout) => {
    const next = fn(layout);
    if (next === layout) return;
    setLayout(next);
    api.saveLayout(next).catch((e: Error) => {
      setError(e.message);
      void load();
    });
  };
  const newId = () => (globalThis.crypto?.randomUUID?.() ?? `g${Date.now()}${Math.random().toString(36).slice(2, 6)}`);
  const addNewGroup = () => {
    const name = prompt('グループの名前（例: 事務棟、工場棟 1階）')?.trim();
    if (name) change((l) => addGroup(l, newId(), name));
  };
  const groupName = (gid: string) => (gid === UNGROUPED ? '未分類' : layout.groups.find((g) => g.id === gid)?.name || '（名称なし）');

  const create = (from?: string, mode?: 'copy' | 'inherit') =>
    run(async () => navigate(`/reports/${(await api.createReport(from, mode)).id}`));

  const remove = (r: ReportSummary) =>
    run(async () => {
      if (!confirm(`「${r.panelName || '無題'}」${r.date ? `（${r.date}）` : ''}を削除します。よろしいですか？`)) return;
      await api.deleteReport(r.id);
      await load();
    });

  /** 表示している並びのまま（印刷の順番もこの並び） */
  const sorted = useMemo(() => {
    const list = [...(items ?? [])];
    if (sort === 'manual') {
      const byId = new Map(list.map((r) => [r.id, r]));
      return flattenLayout(layout).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])); // 未分類 → グループ順
    }
    if (sort === 'name') list.sort(byName);
    else if (sort === 'date') list.sort((a, b) => (a.date === b.date ? byName(a, b) : !a.date ? 1 : !b.date ? -1 : a.date < b.date ? 1 : -1)); // 空欄は最後
    return list; // updated は API の順（更新が新しい順）
  }, [items, sort, layout]);

  const allSelected = sorted.length > 0 && sorted.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((sel) => {
      const next = new Set(sel);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** open: PDF を新しいタブで開く（そこで Ctrl+P で印刷）／ save: PDF または Excel を保存する */
  const print = (ids: string[], how: 'open' | 'save', label: string, format: 'pdf' | 'xlsx' = 'pdf') =>
    run(async () => {
      if (ids.length === 0) return;
      setBusy(`${label}（${ids.length}件）の ${format === 'xlsx' ? 'Excel' : 'PDF'} を作成しています…`);
      try {
        const { blob, name } = await api.printReports(ids, format);
        const url = URL.createObjectURL(blob);
        if (how === 'open') {
          const w = window.open(url, '_blank');
          if (!w) throw new Error('新しいタブを開けませんでした（ポップアップがブロックされています）。「PDF で保存」を使うか、ブラウザのポップアップを許可してください。');
        } else {
          const a = document.createElement('a');
          a.href = url;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
        setTimeout(() => URL.revokeObjectURL(url), 120_000);
      } finally {
        setBusy('');
      }
    });

  const byId = useMemo(() => new Map((items ?? []).map((r) => [r.id, r])), [items]);

  /** 一覧の1行。manual のときは、順番・グループ・↑↓ も出す */
  const row = (r: ReportSummary, pos?: { gid: string; index: number; count: number }) => (
    <tr key={r.id} className={selected.has(r.id) ? 'picked' : ''}>
      <td className="chk">
        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`${r.panelName || '無題'}を選択`} />
      </td>
      {pos && (
        <td className="order-col">
          <OrderInput index={pos.index} count={pos.count} onMove={(to) => change((l) => reorderInGroup(l, pos.gid, [r.id], to))} />
        </td>
      )}
      <td>
        <a href={`#/reports/${r.id}`}>{r.panelName || '（無題）'}</a>
      </td>
      <td>{r.location}</td>
      <td>{r.date || <span className="muted">（空欄）</span>}</td>
      <td className="num">{r.circuitCount}</td>
      <td>{new Date(r.updatedAt).toLocaleString('ja-JP')}</td>
      {pos && (
        <td>
          <select value={pos.gid} onChange={(e) => change((l) => moveToGroup(l, [r.id], e.target.value))} aria-label={`${r.panelName || '無題'}のグループ`}>
            <option value={UNGROUPED}>未分類</option>
            {layout.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name || '（名称なし）'}
              </option>
            ))}
          </select>
        </td>
      )}
      <td className="actions">
        {pos && (
          <>
            <button title="上へ" disabled={pos.index === 0} onClick={() => change((l) => reorderInGroup(l, pos.gid, [r.id], pos.index - 1))}>
              ↑
            </button>
            <button title="下へ" disabled={pos.index >= pos.count - 1} onClick={() => change((l) => reorderInGroup(l, pos.gid, [r.id], pos.index + 1))}>
              ↓
            </button>
          </>
        )}
        <button onClick={() => create(r.id, 'copy')} title="測定値も含めてすべて複製">
          複製
        </button>
        <button onClick={() => create(r.id, 'inherit')} title="盤・回路構成を引き継ぎ、測定値は空で新規作成">
          前回値を引き継いで新規
        </button>
        <button className="danger" onClick={() => remove(r)}>
          削除
        </button>
      </td>
    </tr>
  );

  const selectedIds = sorted.filter((r) => selected.has(r.id)).map((r) => r.id); // 並び順どおり
  const allIds = sorted.map((r) => r.id);

  const manual = sort === 'manual';
  // 選んだ盤が、すべて同じグループ（または未分類）にあるか
  const selGroups = new Set(selectedIds.map((id) => groupOf(layout, id)));
  const sameGroup = selGroups.size === 1;
  const sameGid = sameGroup ? ([...selGroups][0] ?? UNGROUPED) : UNGROUPED;
  const groupSize = sameGid === UNGROUPED ? layout.ungrouped.length : (layout.groups.find((g) => g.id === sameGid)?.ids.length ?? 0);
  const moveWithin = () => {
    const to = parseOrder(moveNo, groupSize);
    if (!sameGroup || to === undefined) return;
    change((l) => reorderInGroup(l, sameGid, selectedIds, to));
    setMoveNo('');
  };

  return (
    <section>
      <div className="toolbar">
        <h1>報告書一覧</h1>
        <button className="primary" onClick={() => create()}>
          ＋ 新規作成
        </button>
        <a className="button primary" href="#/import">
          📄 図面から作成
        </a>
      </div>
      {error && <p className="error">{error}</p>}
      {items === null ? (
        <p>読み込み中…</p>
      ) : items.length === 0 ? (
        <p className="muted">報告書はまだありません。「新規作成」から作成してください。</p>
      ) : (
        <>
          <div className="toolbar print-bar">
            <label className="inline-label-row">
              並び順
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} title="印刷の順番も、この並びになります">
                {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            {manual && (
              <button onClick={addNewGroup} title="名前を付けたグループを作ります（例: 事務棟、工場棟 1階）。盤は、グループに入れて並べられます">
                ＋ グループを追加
              </button>
            )}
            <span className="sep" />
            <button disabled={Boolean(busy) || selectedIds.length === 0} onClick={() => print(selectedIds, 'open', '選択印刷')} title="チェックを入れた報告書を、1つの PDF にまとめて開きます（開いた画面で Ctrl+P で印刷）">
              🖨 選択印刷（{selectedIds.length}件）
            </button>
            <button disabled={Boolean(busy) || selectedIds.length === 0} onClick={() => print(selectedIds, 'save', '選択')} title="チェックを入れた報告書を、1つの PDF にまとめて保存します">
              選択を PDF 保存
            </button>
            <button disabled={Boolean(busy) || selectedIds.length === 0} onClick={() => print(selectedIds, 'save', '選択', 'xlsx')} title="チェックを入れた報告書を、1つの Excel ファイルにまとめて保存します（報告書1件が1シート）">
              選択を Excel 保存
            </button>
            <span className="sep" />
            <button disabled={Boolean(busy)} onClick={() => print(allIds, 'open', '一括印刷')} title="一覧のすべての報告書を、1つの PDF にまとめて開きます（開いた画面で Ctrl+P で印刷）">
              🖨 一括印刷（全{allIds.length}件）
            </button>
            <button disabled={Boolean(busy)} onClick={() => print(allIds, 'save', '全')} title="一覧のすべての報告書を、1つの PDF にまとめて保存します">
              全部を PDF 保存
            </button>
            <button disabled={Boolean(busy)} onClick={() => print(allIds, 'save', '全', 'xlsx')} title="一覧のすべての報告書を、1つの Excel ファイルにまとめて保存します（報告書1件が1シート）">
              全部を Excel 保存
            </button>
            {busy && <span className="busy">{busy}</span>}
          </div>
          {manual && selectedIds.length > 0 && (
            <div className="toolbar print-bar move-bar">
              <span>選んだ {selectedIds.length} 件を</span>
              <select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} aria-label="移すグループ">
                <option value={UNGROUPED}>未分類</option>
                {layout.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name || '（名称なし）'}
                  </option>
                ))}
              </select>
              <button onClick={() => change((l) => moveToGroup(l, selectedIds, moveTarget))} title="選んだ盤を、そのグループの末尾へ移します">
                へ移す
              </button>
              <span className="sep" />
              <span title="選んだ盤が同じグループにあるときだけ使えます">同じグループ内で</span>
              <input
                className="order wide"
                inputMode="numeric"
                value={moveNo}
                placeholder="番号"
                aria-label="移動先の番号"
                onChange={(e) => setMoveNo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    moveWithin();
                  }
                }}
              />
              番目へ
              <button onClick={moveWithin} disabled={!sameGroup || parseOrder(moveNo, groupSize) === undefined}>
                移動
              </button>
              <button onClick={() => setSelected(new Set())}>選択を解除</button>
            </div>
          )}
          <p className="muted small">印刷は、PDF が新しいタブで開くので、そこで Ctrl+P（またはプリンターのボタン）を押してください。Excel は、報告書1件が1シートの1ファイルになります。順番は、いま表示している並びです（「自分で決めた順」では、未分類 → グループの順）。グループは「＋ グループを追加」で作り、盤は「グループ」の欄か、チェックして「へ移す」で入れます。順は、数字を書き換えて Enter で移せます。</p>
          <table className="list">
            <thead>
              <tr>
                <th className="chk">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => setSelected(e.target.checked ? new Set(allIds) : new Set())}
                    title="すべて選択／解除"
                    aria-label="すべて選択"
                  />
                </th>
                {manual && <th title="グループの中での順番。数字を書き換えて Enter で、その位置へ移ります">順</th>}
                <th>盤名</th>
                <th>設置場所</th>
                <th>測定日</th>
                <th>回路数</th>
                <th>更新日時</th>
                {manual && <th>グループ</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {manual
                ? [
                    ...(layout.ungrouped.length > 0 || layout.groups.length === 0 ? [{ id: UNGROUPED, ids: layout.ungrouped }] : []),
                    ...layout.groups,
                  ].map((g, gi) => {
                    const ids = g.ids.filter((id) => byId.has(id));
                    const named = g.id !== UNGROUPED;
                    const gIndex = layout.groups.findIndex((x) => x.id === g.id);
                    return [
                      <tr key={`h-${g.id}`} className="group-row">
                        <td className="chk">
                          <input
                            type="checkbox"
                            checked={ids.length > 0 && ids.every((id) => selected.has(id))}
                            disabled={ids.length === 0}
                            onChange={(e) =>
                              setSelected((sel) => {
                                const next = new Set(sel);
                                for (const id of ids) (e.target.checked ? next.add(id) : next.delete(id));
                                return next;
                              })
                            }
                            title="このグループの盤をすべて選択／解除"
                            aria-label={`${groupName(g.id)}の盤をすべて選択`}
                          />
                        </td>
                        <td colSpan={8}>
                          <strong>{groupName(g.id)}</strong> <span className="muted">（{ids.length}件）</span>
                          <span className="group-actions">
                            {named && (
                              <>
                                <button title="グループを上へ" disabled={gIndex <= 0} onClick={() => change((l) => moveGroup(l, gIndex, gIndex - 1))}>
                                  ↑
                                </button>
                                <button title="グループを下へ" disabled={gIndex >= layout.groups.length - 1} onClick={() => change((l) => moveGroup(l, gIndex, gIndex + 1))}>
                                  ↓
                                </button>
                                <button
                                  onClick={() => {
                                    const name = prompt('グループの名前', groupName(g.id))?.trim();
                                    if (name) change((l) => renameGroup(l, g.id, name));
                                  }}
                                >
                                  名前変更
                                </button>
                              </>
                            )}
                            <button disabled={Boolean(busy) || ids.length === 0} onClick={() => print(ids, 'open', `${groupName(g.id)} 印刷`)} title="このグループの盤を、1つの PDF にまとめて開きます">
                              🖨 印刷
                            </button>
                            <button disabled={Boolean(busy) || ids.length === 0} onClick={() => print(ids, 'save', groupName(g.id))}>
                              PDF 保存
                            </button>
                            <button disabled={Boolean(busy) || ids.length === 0} onClick={() => print(ids, 'save', groupName(g.id), 'xlsx')}>
                              Excel 保存
                            </button>
                            {named && (
                              <button
                                className="danger"
                                title="グループだけを消します（中の盤は消えず、未分類に戻ります）"
                                onClick={() => confirm(`グループ「${groupName(g.id)}」を削除します。中の ${ids.length} 件の盤は消えず、「未分類」に戻ります。よろしいですか？`) && change((l) => removeGroup(l, g.id))}
                              >
                                グループを削除
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>,
                      ...ids.map((id, i) => row(byId.get(id)!, { gid: g.id, index: i, count: ids.length })),
                      ...(ids.length === 0 ? [<tr key={`e-${g.id}-${gi}`}><td /><td colSpan={8} className="muted small">（まだ盤がありません。盤にチェックを入れて「へ移す」、または各行の「グループ」から入れてください）</td></tr>] : []),
                    ];
                  })
                : sorted.map((r) => row(r))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
