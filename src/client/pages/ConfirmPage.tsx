import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_USE_VOLTAGE } from '../../domain/groundVoltage.ts';
import { LOW_VOLTAGE_MAX_V } from '../../domain/judgment.ts';
import { parseVoltage, voltageLabel } from '../../domain/system.ts';
import type { ExtractedCircuit, ImportRecord } from '../../shared/extraction.ts';
import { WIRING_SYSTEMS, type WiringSystem } from '../../shared/schema.ts';
import { api } from '../api.ts';
import { navigate } from '../nav.ts';

type Key = keyof ExtractedCircuit;
interface PanelState {
  pid: number;
  name: string;
  location: string;
  include: boolean;
  unc: { name?: string; location?: string };
  rows: Row[];
}

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
  const [panels, setPanels] = useState<PanelState[]>([]);
  const [cur, setCur] = useState(0);
  const [mode, setMode] = useState<'new' | 'append' | 'replace'>('new');
  const [applyPanel, setApplyPanel] = useState(false);
  const [saving, setSaving] = useState(false);
  const autoStarted = useRef(false);

  const load = (r: ImportRecord) => {
    setRec(r);
    if (r.targetReportId) setMode((m) => (m === 'new' ? 'append' : m));
    if (r.result) {
      const unc = new Map(r.result.uncertain.map((u) => [u.field, u.reason]));
      setPanels(
        r.result.panels.map((pn, p) => ({
          pid: ridSeq++,
          name: pn.name ?? '',
          location: pn.location ?? '',
          include: true,
          unc: {
            ...(unc.has(`panels.${p}.name`) ? { name: unc.get(`panels.${p}.name`)! } : {}),
            ...(unc.has(`panels.${p}.location`) ? { location: unc.get(`panels.${p}.location`)! } : {}),
          },
          rows: pn.circuits.map((c, i) => {
            const u: Row['unc'] = {};
            for (const k of ['no', 'name', 'system', 'useVoltage', 'breakerA'] as const) {
              const reason = unc.get(`panels.${p}.circuits.${i}.${k}`);
              if (reason) u[k] = reason;
            }
            return toRow(c, u);
          }),
        })),
      );
      setCur(0);
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

  const panel = panels[cur];
  const rows = panel?.rows ?? [];
  const setPanel = (patch: Partial<PanelState>) => setPanels((ps) => ps.map((p, i) => (i === cur ? { ...p, ...patch } : p)));
  const setRows = (fn: (rs: Row[]) => Row[]) => setPanels((ps) => ps.map((p, i) => (i === cur ? { ...p, rows: fn(p.rows) } : p)));

  /** 盤ごとの入力エラー（反映対象の盤だけ検査する） */
  const errorsOf = (pn: PanelState): { rowErrors: string[][]; nameMissing: boolean } => ({
    rowErrors: pn.rows.map((r) => {
      const e: string[] = [];
      if (!r.system) e.push('電気方式');
      const v = parseVoltage(r.useVoltage);
      if (v === undefined || Number.isNaN(v) || v <= 0) e.push('使用電圧');
      else if (v > LOW_VOLTAGE_MAX_V) e.push(`使用電圧（低圧は${LOW_VOLTAGE_MAX_V}V以下。高圧の回路は外してください）`);
      const b = num(r.breakerA);
      if (b !== undefined && (Number.isNaN(b) || b < 0)) e.push('ブレーカ容量');
      return e;
    }),
    nameMissing: mode === 'new' && !pn.name.trim(),
  });
  const allErrors = panels.map(errorsOf);
  const included = panels.filter((p) => p.include);
  const errorPanels = panels.flatMap((p, i) => (p.include && (allErrors[i]!.nameMissing || allErrors[i]!.rowErrors.some((e) => e.length)) ? [i] : []));
  const rowErrors = panel ? allErrors[cur]!.rowErrors : [];
  const hasErrors = errorPanels.length > 0;
  const uncOf = (pn: PanelState) => pn.rows.reduce((n, r) => n + Object.keys(r.unc).length, 0) + Object.keys(pn.unc).length;
  const remainingUnc = included.reduce((n, p) => n + uncOf(p), 0);
  const totalCircuits = included.reduce((n, p) => n + p.rows.length, 0);
  const needSingle = mode !== 'new' && included.length !== 1;

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
    if (hasErrors || needSingle) return;
    if (remainingUnc > 0 && !window.confirm(`黄色の「要確認」項目が ${remainingUnc} 件残っています。元資料と見比べて確認しましたか？\n確定すると報告書に反映します。`)) return;
    if (mode === 'replace' && !window.confirm('報告書の回路を、この内容で置き換えます（入力済みの測定値も消えます）。よろしいですか？')) return;
    setSaving(true);
    try {
      const { reports } = await api.confirmImport(id, {
        mode,
        ...(rec.targetReportId && mode !== 'new' ? { targetReportId: rec.targetReportId } : {}),
        applyPanel: mode === 'new' || applyPanel,
        panels: included.map((pn) => ({
          panel: { name: pn.name.trim(), location: pn.location.trim() },
          circuits: pn.rows.map((r) => {
            const b = num(r.breakerA);
            return {
              no: r.no.trim(),
              name: r.name.trim(),
              system: r.system as WiringSystem,
              useVoltage: parseVoltage(r.useVoltage)!,
              ...(voltageLabel(r.useVoltage) ? { voltageLabel: voltageLabel(r.useVoltage)! } : {}),
              ...(b !== undefined ? { breakerA: b } : {}),
            };
          }),
        })),
      });
      // 盤が複数なら一覧へ（作った報告書が並ぶ）、1つならその報告書へ
      navigate(reports.length === 1 ? `/reports/${reports[0]!.id}` : '/');
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
          {panels.length > 1 && (
            <div className="panel-tabs" role="tablist">
              {panels.map((pn, i) => (
                <button
                  key={pn.pid}
                  role="tab"
                  className={`${i === cur ? 'active' : ''} ${!pn.include ? 'excluded' : ''}`}
                  onClick={() => setCur(i)}
                  title={pn.name}
                >
                  {pn.name || `（盤${i + 1}）`}
                  <small>
                    {pn.rows.length}回路{uncOf(pn) > 0 && <span className="unc-count"> 要確認{uncOf(pn)}</span>}
                    {allErrors[i]!.rowErrors.some((e) => e.length) && pn.include && <span className="err-count"> 入力不足</span>}
                  </small>
                </button>
              ))}
            </div>
          )}
          {panels.length > 1 && !confirmed && (
            <p className="muted small">
              この資料には盤が {panels.length} 面あります。盤ごとのタブで内容を確認してください。
              「新しい報告書」では、チェックを入れた盤の数だけ報告書を作ります。
            </p>
          )}
          {!panel ? (
            <p className="warn">読み取り結果がありません。「読み取り開始」を押してください。</p>
          ) : (
          <>
          {panels.length > 1 && !confirmed && (
            <label className="check include">
              <input type="checkbox" checked={panel.include} onChange={(e) => setPanel({ include: e.target.checked })} />
              この盤を報告書に反映する
            </label>
          )}
          <fieldset>
            <legend>盤</legend>
            <label className={uncCls(panel.unc.name)} title={panel.unc.name}>
              盤名
              <input
                value={panel.name}
                disabled={confirmed}
                onChange={(e) => {
                  const { name: _n, ...unc } = panel.unc;
                  setPanel({ name: e.target.value, unc });
                }}
              />
              {panel.unc.name && <small>要確認: {panel.unc.name}</small>}
            </label>
            <label className={uncCls(panel.unc.location)} title={panel.unc.location}>
              設置場所
              <input
                value={panel.location}
                disabled={confirmed}
                onChange={(e) => {
                  const { location: _l, ...unc } = panel.unc;
                  setPanel({ location: e.target.value, unc });
                }}
              />
              {panel.unc.location && <small>要確認: {panel.unc.location}</small>}
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
                              next.splice(i + 1, 0, { ...toRow({ no: null, name: null, system: r.system || null, useVoltage: null, breakerA: null }, {}), useVoltage: r.useVoltage });
                              setRows(() => next);
                            }}
                          >
                            ＋
                          </button>
                          <button tabIndex={-1} className="danger" title="削除" onClick={() => setRows((rs) => rs.filter((x) => x.rid !== r.rid))}>
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
                <button onClick={() => setRows((rs) => [...rs, toRow({ no: String(rows.length + 1), name: null, system: '1φ3W', useVoltage: DEFAULT_USE_VOLTAGE['1φ3W'], breakerA: null }, {})])}>
                  ＋ 回路を追加
                </button>
                <span className="muted">
                  <span className="unc-sample">黄色</span> = AI/OCR が自信なし・読めなかった項目（マウスを乗せると理由を表示。直すと強調が消えます）。
                </span>
              </div>
            )}
          </div>

          </>
          )}

          {!confirmed && panel && (
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
                <p>
                  新しい報告書を作成します{included.length > 1 ? `（盤ごとに ${included.length} 件）` : ''}。
                </p>
              )}
              {needSingle && <p className="error">既存の報告書へ反映できるのは1つの盤だけです。反映する盤を1つだけ選んでください（盤ごとのタブの「この盤を報告書に反映する」）。</p>}
              {hasErrors && (
                <div className="error">
                  {errorPanels.map((i) => (
                    <div key={panels[i]!.pid}>
                      {panels.length > 1 ? `「${panels[i]!.name || `盤${i + 1}`}」: ` : ''}
                      {allErrors[i]!.nameMissing ? '盤名を入力してください。' : ''}
                      {allErrors[i]!.rowErrors.map((e, r) => (e.length ? `${r + 1}行目: ${e.join('・')}を入力してください。` : '')).join(' ')}
                    </div>
                  ))}
                </div>
              )}
              <button className="primary" disabled={hasErrors || needSingle || saving || totalCircuits === 0 || running} onClick={confirm}>
                {saving ? '反映中…' : `確定して報告書に反映（${included.length}面・${totalCircuits}回路）`}
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
  const [rot, setRot] = useState<Record<number, number>>({}); // ページごとの表示の回転（度）。読み取りには影響しない
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
        <button title="左に90度回転（表示だけ。読み取りには影響しません）" onClick={() => setRot({ ...rot, [page]: ((rot[page] ?? 0) + 270) % 360 })}>↺</button>
        <button title="右に90度回転（表示だけ。読み取りには影響しません）" onClick={() => setRot({ ...rot, [page]: ((rot[page] ?? 0) + 90) % 360 })}>↻</button>
        <a href={`/api/imports/${rec.id}/files/${p.fileIndex}`} target="_blank" rel="noreferrer">
          元ファイル
        </a>
      </div>
      <div className="viewer-body">
        {(() => {
          const deg = rot[page] ?? 0;
          const sideways = deg === 90 || deg === 270;
          const dispW = sideways ? p.height : p.width;
          const dispH = sideways ? p.width : p.height;
          return (
            <div
              className="rot-box"
              style={{
                width: zoom ? `${dispW * zoom}px` : '100%',
                aspectRatio: `${dispW} / ${dispH}`,
                maxWidth: zoom ? 'none' : undefined,
              }}
            >
              <img
                src={`/api/imports/${rec.id}/pages/${p.index}`}
                alt={`${p.fileName} ${p.pageNo}ページ`}
                style={{ width: `calc(100cqw * ${p.width} / ${dispW})`, transform: `translate(-50%, -50%) rotate(${deg}deg)` }}
              />
            </div>
          );
        })()}
      </div>
    </div>
  );
}
