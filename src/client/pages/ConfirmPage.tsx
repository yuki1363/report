import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_USE_VOLTAGE } from '../../domain/groundVoltage.ts';
import type { ExtractedCircuit, ImportRecord } from '../../shared/extraction.ts';
import { WIRING_SYSTEMS, type WiringSystem } from '../../shared/schema.ts';
import { api } from '../api.ts';
import { navigate } from '../nav.ts';

type Key = keyof ExtractedCircuit;
interface Row {
  rid: number;
  no: string;
  name: string;
  system: WiringSystem | '';
  useVoltage: string;
  breakerA: string;
  /** 読み取り時に「自信なし」とされた項目と理由 */
  unc: Partial<Record<Key, string>>;
}

let ridSeq = 0;
const toRow = (c: ExtractedCircuit, unc: Row['unc']): Row => ({
  rid: ridSeq++,
  no: c.no ?? '',
  name: c.name ?? '',
  system: c.system ?? '',
  useVoltage: c.useVoltage === null ? '' : String(c.useVoltage),
  breakerA: c.breakerA === null ? '' : String(c.breakerA),
  unc,
});

const num = (s: string): number | undefined => {
  const t = s.trim().replace(/[０-９．]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/** 確認・修正画面（左: 元資料、右: 抽出結果）。利用者が確定するまで報告書には反映しない。 */
export function ConfirmPage({ id, auto }: { id: string; auto: boolean }) {
  const [rec, setRec] = useState<ImportRecord | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [panel, setPanel] = useState({ name: '', location: '' });
  const [panelUnc, setPanelUnc] = useState<{ name?: string; location?: string }>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<'new' | 'append' | 'replace'>('new');
  const [applyPanel, setApplyPanel] = useState(false);
  const [saving, setSaving] = useState(false);
  const autoStarted = useRef(false);

  const load = (r: ImportRecord) => {
    setRec(r);
    if (r.targetReportId) setMode((m) => (m === 'new' ? 'append' : m));
    if (r.result) {
      const unc = new Map(r.result.uncertain.map((u) => [u.field, u.reason]));
      setPanel({ name: r.result.panel.name ?? '', location: r.result.panel.location ?? '' });
      setPanelUnc({ ...(unc.has('panel.name') ? { name: unc.get('panel.name')! } : {}), ...(unc.has('panel.location') ? { location: unc.get('panel.location')! } : {}) });
      setRows(
        r.result.circuits.map((c, i) => {
          const u: Row['unc'] = {};
          for (const k of ['no', 'name', 'system', 'useVoltage', 'breakerA'] as const) {
            const reason = unc.get(`circuits.${i}.${k}`);
            if (reason) u[k] = reason;
          }
          return toRow(c, u);
        }),
      );
    }
  };

  const run = async () => {
    setRunning(true);
    setError('');
    try {
      load(await api.extract(id));
    } catch (e) {
      setError((e as Error).message);
      setRec(await api.getImport(id).catch(() => null));
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    api
      .getImport(id)
      .then((r) => {
        load(r);
        if (auto && r.status === 'uploaded' && !autoStarted.current) {
          autoStarted.current = true;
          void run();
        }
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const rowErrors = useMemo(
    () =>
      rows.map((r) => {
        const e: string[] = [];
        if (!r.system) e.push('電気方式');
        const v = num(r.useVoltage);
        if (v === undefined || Number.isNaN(v) || v <= 0) e.push('使用電圧');
        const b = num(r.breakerA);
        if (b !== undefined && (Number.isNaN(b) || b < 0)) e.push('ブレーカ容量');
        return e;
      }),
    [rows],
  );
  const hasErrors = rowErrors.some((e) => e.length) || (mode === 'new' && !panel.name.trim());
  const remainingUnc = rows.reduce((n, r) => n + Object.keys(r.unc).length, 0) + Object.keys(panelUnc).length;

  if (!rec) return error ? <p className="error">{error}</p> : <p>読み取り中…</p>;

  const setRow = (rid: number, patch: Partial<Row>, touched?: Key) =>
    setRows((rs) =>
      rs.map((r) => {
        if (r.rid !== rid) return r;
        const unc = { ...r.unc };
        // 利用者が直した項目は「確認済み」として強調を外す
        if (touched) delete unc[touched];
        return { ...r, ...patch, unc };
      }),
    );

  const confirm = async () => {
    if (hasErrors) return;
    if (remainingUnc > 0 && !window.confirm(`黄色の「要確認」項目が ${remainingUnc} 件残っています。元資料と見比べて確認しましたか？\n確定すると報告書に反映します。`)) return;
    if (mode === 'replace' && !window.confirm('報告書の回路を、この内容で置き換えます（入力済みの測定値も消えます）。よろしいですか？')) return;
    setSaving(true);
    try {
      const report = await api.confirmImport(id, {
        mode,
        ...(rec.targetReportId && mode !== 'new' ? { targetReportId: rec.targetReportId } : {}),
        applyPanel: mode === 'new' || applyPanel,
        panel: { name: panel.name.trim(), location: panel.location.trim() },
        circuits: rows.map((r) => {
          const b = num(r.breakerA);
          return {
            no: r.no.trim(),
            name: r.name.trim(),
            system: r.system as WiringSystem,
            useVoltage: num(r.useVoltage)!,
            ...(b !== undefined ? { breakerA: b } : {}),
          };
        }),
      });
      navigate(`/reports/${report.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const confirmed = rec.status === 'confirmed';
  const uncCls = (reason?: string) => (reason ? 'unc' : '');

  return (
    <section className="confirm">
      <div className="toolbar">
        <a href={rec.targetReportId ? `#/reports/${rec.targetReportId}` : '#/'}>← 戻る</a>
        <h1>確認・修正</h1>
        {rec.engine && (
          <span className="muted">
            読み取り: {rec.engine === 'ai' ? `外部 AI（${rec.model ?? ''}）` : 'オフライン OCR'}
          </span>
        )}
        <div className="spacer" />
        {!confirmed && (
          <button onClick={run} disabled={running}>
            {running ? '読み取り中…' : rec.result ? 'もう一度読み取る' : '読み取り開始'}
          </button>
        )}
      </div>

      {rec.engine === 'ocr' && (
        <p className="warn">
          オフライン読み取り（OCR）の結果です。図面の読み取り精度は低く、回路の区切りや文字を誤っている可能性が高いため、すべての項目を元資料と見比べてください。
        </p>
      )}
      {running && <p className="info busy">資料を読み取っています。ページ数によっては1〜2分かかります…</p>}
      {error && <p className="error">{error}</p>}
      {rec.status === 'failed' && rec.error && !error && <p className="error">{rec.error}</p>}
      {confirmed && (
        <p className="info">
          この取込は確定済みです。<a href={`#/reports/${rec.confirmedReportId}`}>報告書を開く</a>
        </p>
      )}

      <div className="confirm-split">
        <SourceViewer rec={rec} />
        <div className="confirm-right">
          <fieldset>
            <legend>盤</legend>
            <label className={uncCls(panelUnc.name)} title={panelUnc.name}>
              盤名
              <input
                value={panel.name}
                disabled={confirmed}
                onChange={(e) => {
                  setPanel({ ...panel, name: e.target.value });
                  setPanelUnc(({ name: _n, ...rest }) => rest);
                }}
              />
              {panelUnc.name && <small>要確認: {panelUnc.name}</small>}
            </label>
            <label className={uncCls(panelUnc.location)} title={panelUnc.location}>
              設置場所
              <input
                value={panel.location}
                disabled={confirmed}
                onChange={(e) => {
                  setPanel({ ...panel, location: e.target.value });
                  setPanelUnc(({ location: _l, ...rest }) => rest);
                }}
              />
              {panelUnc.location && <small>要確認: {panelUnc.location}</small>}
            </label>
          </fieldset>

          <div className="grid-wrap">
            <table className="grid confirm-grid">
              <thead>
                <tr>
                  <th>No</th>
                  <th>回路名称</th>
                  <th>電気方式</th>
                  <th>使用電圧[V]</th>
                  <th>ブレーカ[A]（参考）</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.rid} className={rowErrors[i]!.length ? 'row-error' : ''}>
                    <td className={uncCls(r.unc.no)} title={r.unc.no}>
                      <input className="no" value={r.no} disabled={confirmed} onChange={(e) => setRow(r.rid, { no: e.target.value }, 'no')} />
                    </td>
                    <td className={uncCls(r.unc.name)} title={r.unc.name}>
                      <input className="name" value={r.name} disabled={confirmed} onChange={(e) => setRow(r.rid, { name: e.target.value }, 'name')} />
                    </td>
                    <td className={uncCls(r.unc.system)} title={r.unc.system}>
                      <select value={r.system} disabled={confirmed} onChange={(e) => setRow(r.rid, { system: e.target.value as WiringSystem }, 'system')}>
                        <option value="">（未選択）</option>
                        {WIRING_SYSTEMS.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td className={uncCls(r.unc.useVoltage)} title={r.unc.useVoltage}>
                      <input className="volt" inputMode="decimal" value={r.useVoltage} disabled={confirmed} onChange={(e) => setRow(r.rid, { useVoltage: e.target.value }, 'useVoltage')} />
                    </td>
                    <td className={uncCls(r.unc.breakerA)} title={r.unc.breakerA}>
                      <input className="volt" inputMode="decimal" value={r.breakerA} disabled={confirmed} onChange={(e) => setRow(r.rid, { breakerA: e.target.value }, 'breakerA')} />
                    </td>
                    <td className="row-actions">
                      {!confirmed && (
                        <>
                          <button
                            tabIndex={-1}
                            title="この下に行を挿入"
                            onClick={() => {
                              const next = [...rows];
                              next.splice(i + 1, 0, toRow({ no: null, name: null, system: r.system || null, useVoltage: num(r.useVoltage) ?? null, breakerA: null }, {}));
                              setRows(next);
                            }}
                          >
                            ＋
                          </button>
                          <button tabIndex={-1} className="danger" title="削除" onClick={() => setRows(rows.filter((x) => x.rid !== r.rid))}>
                            ×
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!confirmed && (
              <div className="grid-footer">
                <button onClick={() => setRows([...rows, toRow({ no: String(rows.length + 1), name: null, system: '1φ3W', useVoltage: DEFAULT_USE_VOLTAGE['1φ3W'], breakerA: null }, {})])}>
                  ＋ 回路を追加
                </button>
                <span className="muted">
                  <span className="unc-sample">黄色</span> = AI/OCR が自信なし・読めなかった項目（マウスを乗せると理由を表示。直すと強調が消えます）。
                </span>
              </div>
            )}
          </div>

          {!confirmed && (
            <fieldset className="confirm-actions">
              <legend>確定</legend>
              {rec.targetReportId ? (
                <>
                  <label className="check">
                    <input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} /> 報告書の回路の後ろに<strong>追加</strong>
                  </label>
                  <label className="check">
                    <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> 報告書の回路を<strong>置き換え</strong>（測定値も消えます）
                  </label>
                  <label className="check">
                    <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> 別の新しい報告書を作る
                  </label>
                  {mode !== 'new' && (
                    <label className="check">
                      <input type="checkbox" checked={applyPanel} onChange={(e) => setApplyPanel(e.target.checked)} /> 盤名・設置場所も上書きする
                    </label>
                  )}
                </>
              ) : (
                <p>新しい報告書を作成します。</p>
              )}
              {hasErrors && (
                <p className="error">
                  {mode === 'new' && !panel.name.trim() ? '盤名を入力してください。' : ''}
                  {rowErrors.map((e, i) => (e.length ? `${i + 1}行目: ${e.join('・')}を入力してください。` : '')).join(' ')}
                </p>
              )}
              <button className="primary" disabled={hasErrors || saving || rows.length === 0 || running} onClick={confirm}>
                {saving ? '反映中…' : `確定して報告書に反映（${rows.length}回路）`}
              </button>
            </fieldset>
          )}
        </div>
      </div>
    </section>
  );
}

/** 元資料の表示（拡大・縮小・ページ送り） */
function SourceViewer({ rec }: { rec: ImportRecord }) {
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(0); // 0 = 幅に合わせる
  const p = rec.pages[page];
  if (!p) return <div className="viewer">ページがありません</div>;
  return (
    <div className="viewer">
      <div className="viewer-bar">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          ◀
        </button>
        <span>
          {page + 1} / {rec.pages.length}
        </span>
        <button disabled={page >= rec.pages.length - 1} onClick={() => setPage(page + 1)}>
          ▶
        </button>
        <span className="muted ellipsis" title={p.fileName}>
          {p.fileName}
          {p.kind !== 'image' && ` p.${p.pageNo}`}（{p.kind === 'pdf-text' ? 'テキスト PDF' : p.kind === 'pdf-scan' ? 'スキャン PDF' : '画像'}）
        </span>
        <div className="spacer" />
        <button onClick={() => setZoom(Math.max(0.25, (zoom || 1) / 1.25))}>－</button>
        <span>{zoom ? `${Math.round(zoom * 100)}%` : '幅'}</span>
        <button onClick={() => setZoom(Math.min(4, (zoom || 1) * 1.25))}>＋</button>
        <button onClick={() => setZoom(0)}>幅に合わせる</button>
        <a href={`/api/imports/${rec.id}/files/${p.fileIndex}`} target="_blank" rel="noreferrer">
          元ファイル
        </a>
      </div>
      <div className="viewer-body">
        <img
          src={`/api/imports/${rec.id}/pages/${p.index}`}
          alt={`${p.fileName} ${p.pageNo}ページ`}
          style={zoom ? { width: `${p.width * zoom}px`, maxWidth: 'none' } : { width: '100%' }}
        />
      </div>
    </div>
  );
}
