import { useEffect, useState } from 'react';
import type { ReportSummary } from '../../shared/schema.ts';
import { api } from '../api.ts';
import { navigate } from '../nav.ts';

export function ReportList() {
  const [items, setItems] = useState<ReportSummary[] | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    api
      .listReports()
      .then(setItems)
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
        <table className="list">
          <thead>
            <tr>
              <th>盤名</th>
              <th>設置場所</th>
              <th>測定日</th>
              <th>測定者</th>
              <th>回路数</th>
              <th>更新日時</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td>
                  <a href={`#/reports/${r.id}`}>{r.panelName || '（無題）'}</a>
                </td>
                <td>{r.location}</td>
                <td>{r.date}</td>
                <td>{r.inspector}</td>
                <td className="num">{r.circuitCount}</td>
                <td>{new Date(r.updatedAt).toLocaleString('ja-JP')}</td>
                <td className="actions">
                  <button onClick={() => create(r.id, 'copy')} title="測定値も含めてすべて複製">
                    複製
                  </button>
                  <button onClick={() => create(r.id, 'inherit')} title="盤・回路構成・測定器を引き継ぎ、測定値は空で新規作成">
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
      )}
    </section>
  );
}
