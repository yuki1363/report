import { useEffect, useState } from 'react';
import type { Sheet } from '../../shared/schema.ts';
import { api, type TemplateSummary } from '../api.ts';
import { navigate } from '../nav.ts';
import { SAMPLE_REPORT } from '../sampleReport.ts';
import { SheetEditor } from '../SheetEditor.tsx';

/** テンプレート一覧（#/templates）と編集（#/templates/<id>） */
export function TemplatesPage({ editId }: { editId?: string }) {
  return editId ? <TemplateEdit id={editId} /> : <TemplateList />;
}

function TemplateList() {
  const [items, setItems] = useState<TemplateSummary[] | null>(null);
  const [error, setError] = useState('');
  const load = () => api.listTemplates().then(setItems).catch((e: Error) => setError(e.message));
  useEffect(() => void load(), []);

  const duplicate = async (t: TemplateSummary) => {
    const name = prompt('新しいテンプレートの名前', `${t.name} のコピー`);
    if (!name?.trim()) return;
    try {
      const src = await api.getTemplate(t.id);
      const created = await api.createTemplate(name.trim(), src.sheet);
      navigate(`/templates/${created.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const rename = async (t: TemplateSummary) => {
    const name = prompt('テンプレートの名前', t.name);
    if (!name?.trim()) return;
    try {
      const src = await api.getTemplate(t.id);
      await api.updateTemplate(t.id, name.trim(), src.sheet);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async (t: TemplateSummary) => {
    if (!confirm(`テンプレート「${t.name}」を削除します。よろしいですか？\n（このテンプレートを使っている報告書は、既定のテンプレートで出力されます）`)) return;
    try {
      await api.deleteTemplate(t.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section>
      <div className="toolbar">
        <h1>書式テンプレート</h1>
      </div>
      <p className="muted">
        報告書の書式（レイアウト）のひな形です。報告書の「書式編集」で「テンプレートとして保存」したものもここに並びます。
        既定のテンプレートは変更できないため、「複製して編集」してください。
      </p>
      {error && <p className="error">{error}</p>}
      {items && (
        <table className="list">
          <thead>
            <tr>
              <th>名前</th>
              <th>種類</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.builtin ? '既定' : '利用者'}</td>
                <td className="actions">
                  {!t.builtin && <button onClick={() => navigate(`/templates/${t.id}`)}>編集</button>}
                  <button onClick={() => duplicate(t)}>複製して編集</button>
                  {!t.builtin && <button onClick={() => rename(t)}>名前変更</button>}
                  {!t.builtin && (
                    <button className="danger" onClick={() => remove(t)}>
                      削除
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function TemplateEdit({ id }: { id: string }) {
  const [tpl, setTpl] = useState<{ name: string; sheet: Sheet; builtin: boolean } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.getTemplate(id).then(setTpl).catch((e: Error) => setError(e.message));
  }, [id]);
  if (error) return <p className="error">{error}</p>;
  if (!tpl) return <p>読み込み中…</p>;
  return (
    <section>
      <div className="toolbar">
        <a href="#/templates">← テンプレート一覧</a>
        <h1>テンプレートの編集: {tpl.name}</h1>
      </div>
      <SheetEditor
        initial={tpl.sheet}
        previewReport={SAMPLE_REPORT}
        subtitle="プレビューは見本データで表示します"
        actions={[
          ...(tpl.builtin
            ? []
            : [{ label: '上書き保存', primary: true, onClick: async (sheet: Sheet) => void (await api.updateTemplate(id, tpl.name, sheet)) }]),
          {
            label: '名前を付けて保存…',
            onClick: async (sheet: Sheet) => {
              const name = prompt('テンプレートの名前', `${tpl.name} のコピー`);
              if (!name?.trim()) throw new Error('保存を取り消しました');
              const created = await api.createTemplate(name.trim(), sheet);
              navigate(`/templates/${created.id}`);
            },
          },
        ]}
      />
    </section>
  );
}
