import { useEffect, useMemo, useState } from 'react';
import type { ReportSummary } from '../../shared/schema.ts';
import { api } from '../api.ts';
import { navigate } from '../nav.ts';

type SortKey = 'updated' | 'name' | 'date';
const SORT_LABEL: Record<SortKey, string> = { updated: '更新が新しい順', name: '盤名順', date: '測定日が新しい順' };

/** 盤名の自然順（「No.2」の次が「No.10」になるように数字は数として比べる） */
const byName = (a: ReportSummary, b: ReportSummary) => a.panelName.localeCompare(b.panelName, 'ja', { numeric: true });

export function ReportList() {
  const [items, setItems] = useState<ReportSummary[] | null>(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');

  const load = () =>
    api
      .listReports()
      .then((list) => {
        setItems(list);
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

  const create = (from?: string, mode?: 'copy' | 'inherit') =>
    run(async () => navigate(`/reports/${(await api.createReport(from, mode)).id}`));

  const remove = (r: ReportSummary) =>
    run(async () => {
      if (!confirm(`「${r.panelName || '無題'}」（${r.date}）を削除します。よろしいですか？`)) return;
      await api.deleteReport(r.id);
      await load();
    });

  /** 表示している並びのまま（印刷の順番もこの並び） */
  const sorted = useMemo(() => {
    const list = [...(items ?? [])];
    if (sort === 'name') list.sort(byName);
    else if (sort === 'date') list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : byName(a, b)));
    return list; // updated は API の順（更新が新しい順）
  }, [items, sort]);

  const allSelected = sorted.length > 0 && sorted.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((sel) => {
      const next = new Set(sel);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** open: PDF を新しいタブで開く（そこで Ctrl+P で印刷）／ save: PDF を保存する */
  const print = (ids: string[], how: 'open' | 'save', label: string) =>
    run(async () => {
      if (ids.length === 0) return;
      setBusy(`${label}（${ids.length}件）の PDF を作成しています…`);
      try {
        const { blob, name } = await api.printReports(ids);
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

  const selectedIds = sorted.filter((r) => selected.has(r.id)).map((r) => r.id); // 並び順どおり
  const allIds = sorted.map((r) => r.id);

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
            <span className="sep" />
            <button disabled={Boolean(busy) || selectedIds.length === 0} onClick={() => print(selectedIds, 'open', '選択印刷')} title="チェックを入れた報告書を、1つの PDF にまとめて開きます（開いた画面で Ctrl+P で印刷）">
              🖨 選択印刷（{selectedIds.length}件）
            </button>
            <button disabled={Boolean(busy) || selectedIds.length === 0} onClick={() => print(selectedIds, 'save', '選択')} title="チェックを入れた報告書を、1つの PDF にまとめて保存します">
              選択を PDF 保存
            </button>
            <span className="sep" />
            <button disabled={Boolean(busy)} onClick={() => print(allIds, 'open', '一括印刷')} title="一覧のすべての報告書を、1つの PDF にまとめて開きます（開いた画面で Ctrl+P で印刷）">
              🖨 一括印刷（全{allIds.length}件）
            </button>
            <button disabled={Boolean(busy)} onClick={() => print(allIds, 'save', '全')} title="一覧のすべての報告書を、1つの PDF にまとめて保存します">
              全部を PDF 保存
            </button>
            {busy && <span className="busy">{busy}</span>}
          </div>
          <p className="muted small">印刷は、PDF が新しいタブで開くので、そこで Ctrl+P（またはプリンターのボタン）を押してください。順番は、いま表示している並びです。</p>
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
                <th>盤名</th>
                <th>設置場所</th>
                <th>測定日</th>
                <th>回路数</th>
                <th>更新日時</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className={selected.has(r.id) ? 'picked' : ''}>
                  <td className="chk">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`${r.panelName || '無題'}を選択`} />
                  </td>
                  <td>
                    <a href={`#/reports/${r.id}`}>{r.panelName || '（無題）'}</a>
                  </td>
                  <td>{r.location}</td>
                  <td>{r.date}</td>
                  <td className="num">{r.circuitCount}</td>
                  <td>{new Date(r.updatedAt).toLocaleString('ja-JP')}</td>
                  <td className="actions">
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
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
