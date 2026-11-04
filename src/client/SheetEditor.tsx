/**
 * 書式エディタ（自作の軽量グリッド UI）。CLAUDE.md §5。
 * セルの文字・書式、結合/解除、罫線、列幅/行高のドラッグ変更、行/列の挿入・削除、
 * バインド項目の挿入、繰り返し行・見出し行の指定、Undo/Redo、Ctrl+C/V。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent } from 'react';
import { BINDINGS } from '../domain/generate.ts';
import { printableArea, sheetWidthMm } from '../domain/renderHtml.ts';
import {
  applyBorder, applyStyle, clearValues, clipToTsv, copyRange, deleteCols, deleteRows, expandToMerges, insertCols,
  insertRows, mergeAt, mergeCells, normRange, pasteClip, setColWidth, setNumFmt, setRepeatHeaderRows, setRepeatRegion,
  setRowHeight, setValue, sheetWarnings, tsvToClip, unmergeCells, type BorderMode, type ClipData, type Range,
} from '../domain/sheetOps.ts';
import type { BorderStyle, Cell, Report, Sheet } from '../shared/schema.ts';
import { api } from './api.ts';

const PX_PER_MM = 96 / 25.4;
const HISTORY_LIMIT = 200;
const colName = (c: number) => {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const BORDER_PX: Record<BorderStyle, string> = { thin: '1px solid #000', medium: '2px solid #000', thick: '3px solid #000', double: '3px double #000' };

export interface EditorAction {
  label: string;
  primary?: boolean;
  onClick: (sheet: Sheet) => void | Promise<void>;
}

interface Props {
  initial: Sheet;
  /** プレビューに使う報告書データ */
  previewReport: Report;
  actions: EditorAction[];
  /** 編集中の書式の説明（例: 「この報告書だけの書式」） */
  subtitle?: string;
  onDirtyChange?: (dirty: boolean) => void;
}

export function SheetEditor({ initial, previewReport, actions, subtitle, onDirtyChange }: Props) {
  const [sheet, setSheet] = useState<Sheet>(initial);
  const [past, setPast] = useState<Sheet[]>([]);
  const [future, setFuture] = useState<Sheet[]>([]);
  const [anchor, setAnchor] = useState({ r: 0, c: 0 });
  const [focus, setFocus] = useState({ r: 0, c: 0 });
  const [editText, setEditText] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [borderStyle, setBorderStyle] = useState<BorderStyle>('thin');
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const clipRef = useRef<{ tsv: string; clip: ClipData } | null>(null);
  const savedRef = useRef(initial);

  const dirty = sheet !== savedRef.current;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const rows = sheet.rowHeightsMm.length;
  const cols = sheet.colWidthsMm.length;
  const px = PX_PER_MM * zoom;
  const sel: Range = useMemo(() => expandToMerges(sheet, normRange(anchor, focus)), [sheet, anchor, focus]);
  const active = sheet.cells[`${anchor.r},${anchor.c}`];

  /** 履歴に積んで変更する。文字列はエラーメッセージ。 */
  const commit = useCallback(
    (next: Sheet | string, prev?: Sheet) => {
      if (typeof next === 'string') {
        setMessage(next);
        return;
      }
      setMessage('');
      setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), prev ?? sheet]);
      setFuture([]);
      setSheet(next);
    },
    [sheet],
  );

  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setFuture((f) => [sheet, ...f]);
    setPast(past.slice(0, -1));
    setSheet(prev);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setPast((p) => [...p, sheet]);
    setFuture(future.slice(1));
    setSheet(next);
  };

  // 選択位置がシート外になったら戻す
  useEffect(() => {
    const clampR = (r: number) => Math.min(r, rows - 1);
    const clampC = (c: number) => Math.min(c, cols - 1);
    if (anchor.r >= rows || anchor.c >= cols) setAnchor({ r: clampR(anchor.r), c: clampC(anchor.c) });
    if (focus.r >= rows || focus.c >= cols) setFocus({ r: clampR(focus.r), c: clampC(focus.c) });
  }, [rows, cols, anchor, focus]);

  const select = (r: number, c: number, extend: boolean) => {
    const m = mergeAt(sheet, r, c);
    const pos = m ? { r: m.r1, c: m.c1 } : { r, c };
    if (!extend) setAnchor(pos);
    setFocus(extend ? { r, c } : pos);
    setEditText(null);
  };

  const commitEdit = () => {
    if (editText === null) return;
    if (editText !== (active?.value ?? '')) commit(setValue(sheet, anchor.r, anchor.c, editText));
    setEditText(null);
  };

  const move = (dr: number, dc: number, extend: boolean) => {
    const base = extend ? focus : anchor;
    // 結合セルは飛ばす
    const m = mergeAt(sheet, base.r, base.c);
    let r = base.r + dr, c = base.c + dc;
    if (m && !extend) {
      if (dr > 0) r = m.r2 + 1;
      if (dc > 0) c = m.c2 + 1;
    }
    r = Math.max(0, Math.min(rows - 1, r));
    c = Math.max(0, Math.min(cols - 1, c));
    select(r, c, extend);
  };

  const onGridKey = (e: KeyboardEvent) => {
    if (editText !== null) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      commit(applyStyle(sheet, sel, { bold: active?.style?.bold ? undefined : true }));
      return;
    }
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const a = arrows[e.key];
    if (a) {
      e.preventDefault();
      move(a[0], a[1], e.shiftKey);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      move(0, e.shiftKey ? -1 : 1, false);
      return;
    }
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      setEditText(active?.value ?? '');
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      commit(clearValues(sheet, sel));
      return;
    }
    if (e.key.length === 1 && !ctrl && !e.altKey) {
      // 文字を打つと編集開始（日本語入力は Enter / F2 / ダブルクリックで開始）
      e.preventDefault();
      setEditText(e.key);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const onCopy = (e: ClipboardEvent) => {
    if (editText !== null) return;
    const clip = copyRange(sheet, sel);
    const tsv = clipToTsv(clip);
    clipRef.current = { tsv, clip };
    e.clipboardData.setData('text/plain', tsv);
    e.preventDefault();
  };
  const onCut = (e: ClipboardEvent) => {
    if (editText !== null) return;
    onCopy(e);
    commit(clearValues(sheet, sel));
  };
  const onPaste = (e: ClipboardEvent) => {
    if (editText !== null) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const own = clipRef.current;
    // このエディタでコピーしたもの → 書式・結合ごと。他のアプリから → 文字だけ
    if (own && own.tsv === text) commit(pasteClip(sheet, { r: sel.r1, c: sel.c1 }, own.clip, true));
    else if (text) commit(pasteClip(sheet, { r: sel.r1, c: sel.c1 }, tsvToClip(text), false));
  };

  // 列幅・行高のドラッグ変更（ドラッグ中は履歴に積まず、離した時に1回だけ積む）
  const startResize = (axis: 'col' | 'row', index: number, startPos: number) => {
    gridRef.current?.focus();
    const before = sheet;
    const startSize = axis === 'col' ? sheet.colWidthsMm[index]! : sheet.rowHeightsMm[index]!;
    let latest = sheet;
    const onMove = (ev: MouseEvent) => {
      const delta = ((axis === 'col' ? ev.clientX : ev.clientY) - startPos) / px;
      latest = axis === 'col' ? setColWidth(before, index, startSize + delta) : setRowHeight(before, index, startSize + delta);
      setSheet(latest);
    };
    const onUp = () => {
      removeEventListener('mousemove', onMove);
      removeEventListener('mouseup', onUp);
      if (latest !== before) commit(latest, before);
    };
    addEventListener('mousemove', onMove);
    addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    const up = () => (dragging.current = false);
    addEventListener('mouseup', up);
    return () => removeEventListener('mouseup', up);
  }, []);

  const insertBinding = (k: string) => {
    if (!k) return;
    const token = `{{${k}}}`;
    if (editText !== null && inputRef.current) {
      const el = inputRef.current;
      const s = el.selectionStart ?? editText.length;
      const t = el.selectionEnd ?? s;
      setEditText(editText.slice(0, s) + token + editText.slice(t));
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(s + token.length, s + token.length);
      }, 0);
    } else {
      commit(setValue(sheet, anchor.r, anchor.c, (active?.value ?? '') + token));
    }
  };

  const showPreview = async () => {
    setBusy(true);
    try {
      setPreview(await api.renderHtml(sheet, previewReport));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (a: EditorAction) => {
    commitEdit();
    setBusy(true);
    try {
      await a.onClick(sheet);
      savedRef.current = sheet;
      setMessage('');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 結合・被覆セルの表
  const { mergeStart, covered } = useMemo(() => {
    const mergeStart = new Map<string, Range>();
    const covered = new Set<string>();
    for (const m of sheet.merges) {
      mergeStart.set(`${m.r1},${m.c1}`, m);
      for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(`${r},${c}`);
    }
    return { mergeStart, covered };
  }, [sheet.merges]);

  const cellStyle = (cell: Cell | undefined): CSSProperties => {
    const s = cell?.style ?? {};
    const b = s.border ?? {};
    return {
      fontSize: `${(s.sizePt ?? 9) * zoom}pt`,
      fontWeight: s.bold ? 'bold' : undefined,
      textAlign: s.hAlign ?? 'left',
      verticalAlign: s.vAlign === 'top' ? 'top' : s.vAlign === 'bottom' ? 'bottom' : 'middle',
      background: s.fill,
      whiteSpace: s.wrap ? 'pre-wrap' : 'pre',
      borderTop: b.t ? BORDER_PX[b.t] : undefined,
      borderRight: b.r ? BORDER_PX[b.r] : undefined,
      borderBottom: b.b ? BORDER_PX[b.b] : undefined,
      borderLeft: b.l ? BORDER_PX[b.l] : undefined,
      fontFamily: s.font ? `"${s.font}", sans-serif` : undefined,
    };
  };

  const inSel = (r: number, c: number) => r >= sel.r1 && r <= sel.r2 && c >= sel.c1 && c <= sel.c2;
  const rr = sheet.repeatRegion;
  const rh = sheet.page.repeatHeaderRows;
  const warnings = sheetWarnings(sheet);
  const overflow = Math.round((sheetWidthMm(sheet) - printableArea(sheet).w) * 10) / 10;
  const st = active?.style ?? {};
  const toggle = (k: 'bold' | 'wrap' | 'shrinkToFit') => commit(applyStyle(sheet, sel, { [k]: st[k] ? undefined : true }));

  return (
    <div className="sheet-editor">
      <div className="toolbar editor-actions">
        {subtitle && <span className="muted">{subtitle}</span>}
        {dirty && <span className="save save-dirty">未保存の変更あり</span>}
        <div className="spacer" />
        <button onClick={undo} disabled={!past.length} title="元に戻す（Ctrl+Z）">↶ 元に戻す</button>
        <button onClick={redo} disabled={!future.length} title="やり直し（Ctrl+Y）">↷ やり直し</button>
        <button onClick={preview ? () => setPreview(null) : showPreview} disabled={busy}>
          {preview ? '書式編集に戻る' : 'プレビュー'}
        </button>
        {actions.map((a) => (
          <button key={a.label} className={a.primary ? 'primary' : ''} disabled={busy} onClick={() => runAction(a)}>
            {a.label}
          </button>
        ))}
      </div>
      {message && <p className="error">{message}</p>}

      {preview !== null ? (
        <div className="preview">
          <p className="muted">PDF と同じ HTML で表示しています（保存前の書式）。</p>
          <iframe title="プレビュー" srcDoc={preview} />
        </div>
      ) : (
        <>
          <div className="ribbon">
            <div className="group">
              <select
                title="文字サイズ"
                value={st.sizePt ?? 9}
                onChange={(e) => commit(applyStyle(sheet, sel, { sizePt: Number(e.target.value) }))}
              >
                {[6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24].map((n) => (
                  <option key={n} value={n}>{n}pt</option>
                ))}
              </select>
              <button className={st.bold ? 'on' : ''} onClick={() => toggle('bold')} title="太字（Ctrl+B）"><b>B</b></button>
              <button className={st.wrap ? 'on' : ''} onClick={() => toggle('wrap')} title="折り返して全体を表示">折返</button>
              <button className={st.shrinkToFit ? 'on' : ''} onClick={() => toggle('shrinkToFit')} title="縮小して全体を表示">縮小</button>
              <input
                type="color"
                title="塗りつぶし"
                value={st.fill ?? '#ffffff'}
                onChange={(e) => commit(applyStyle(sheet, sel, { fill: e.target.value === '#ffffff' ? undefined : e.target.value }))}
              />
              <button onClick={() => commit(applyStyle(sheet, sel, { fill: undefined }))} title="塗りつぶしなし">塗消</button>
            </div>
            <div className="group">
              {(['left', 'center', 'right'] as const).map((h) => (
                <button key={h} className={(st.hAlign ?? 'left') === h ? 'on' : ''} onClick={() => commit(applyStyle(sheet, sel, { hAlign: h }))}>
                  {{ left: '左', center: '中', right: '右' }[h]}
                </button>
              ))}
              {(['top', 'middle', 'bottom'] as const).map((v) => (
                <button key={v} className={(st.vAlign ?? 'middle') === v ? 'on' : ''} onClick={() => commit(applyStyle(sheet, sel, { vAlign: v }))}>
                  {{ top: '上', middle: '中央', bottom: '下' }[v]}
                </button>
              ))}
              <select
                title="表示形式"
                value={active?.numFmt ?? ''}
                onChange={(e) => commit(setNumFmt(sheet, sel, e.target.value || undefined))}
              >
                <option value="">表示形式: そのまま</option>
                <option value="0">0</option>
                <option value="0.0">0.0</option>
                <option value="0.00">0.00</option>
                <option value="0.000">0.000</option>
              </select>
            </div>
            <div className="group">
              <select title="罫線の種類" value={borderStyle} onChange={(e) => setBorderStyle(e.target.value as BorderStyle)}>
                <option value="thin">細線</option>
                <option value="medium">中線</option>
                <option value="thick">太線</option>
                <option value="double">二重線</option>
              </select>
              {(
                [
                  ['all', '格子'],
                  ['outer', '外枠'],
                  ['inner', '内側'],
                  ['top', '上'],
                  ['bottom', '下'],
                  ['left', '左'],
                  ['right', '右'],
                  ['none', '罫線なし'],
                ] as [BorderMode, string][]
              ).map(([m, label]) => (
                <button key={m} onClick={() => commit(applyBorder(sheet, sel, m, borderStyle))}>{label}</button>
              ))}
            </div>
            <div className="group">
              <button onClick={() => commit(mergeCells(sheet, sel))} title="セルを結合">結合</button>
              <button onClick={() => commit(unmergeCells(sheet, sel))} title="結合を解除">解除</button>
              <button onClick={() => commit(insertRows(sheet, sel.r1, sel.r2 - sel.r1 + 1))}>行を上に挿入</button>
              <button onClick={() => commit(insertRows(sheet, sel.r2 + 1, sel.r2 - sel.r1 + 1))}>行を下に挿入</button>
              <button onClick={() => commit(deleteRows(sheet, sel.r1, sel.r2 - sel.r1 + 1))}>行を削除</button>
              <button onClick={() => commit(insertCols(sheet, sel.c1, sel.c2 - sel.c1 + 1))}>列を左に挿入</button>
              <button onClick={() => commit(insertCols(sheet, sel.c2 + 1, sel.c2 - sel.c1 + 1))}>列を右に挿入</button>
              <button onClick={() => commit(deleteCols(sheet, sel.c1, sel.c2 - sel.c1 + 1))}>列を削除</button>
            </div>
            <div className="group">
              <button onClick={() => commit(setRepeatRegion(sheet, sel.r1, sel.r2))} title="選択した行を、回路の数だけ繰り返して出力します">
                選択行を「回路行」に
              </button>
              <button onClick={() => commit(setRepeatHeaderRows(sheet, sel.r1, sel.r2))} title="改ページした時に、各ページの先頭に繰り返す行">
                選択行を「見出し行」に
              </button>
              {rh && (
                <button onClick={() => { const { repeatHeaderRows: _x, ...page } = sheet.page; commit({ ...sheet, page }); }}>見出し行を解除</button>
              )}
            </div>
            <PageSetup sheet={sheet} commit={commit} />
            <div className="group">
              表示
              <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((z) => (
                  <option key={z} value={z}>{Math.round(z * 100)}%</option>
                ))}
              </select>
            </div>
          </div>

          <div className="formula-bar">
            <span className="cell-ref">
              {colName(sel.c1)}{sel.r1 + 1}
              {(sel.r1 !== sel.r2 || sel.c1 !== sel.c2) && `:${colName(sel.c2)}${sel.r2 + 1}`}
            </span>
            <select value="" onChange={(e) => insertBinding(e.target.value)} title="差し込む項目（報告書のデータに置き換わります）">
              <option value="">＋ 項目を差し込む…</option>
              <optgroup label="報告書">
                {BINDINGS.filter((b) => b.scope === 'report').map((b) => (
                  <option key={b.key} value={b.key}>{b.label}</option>
                ))}
              </optgroup>
              <optgroup label="回路（回路行の中で使う）">
                {BINDINGS.filter((b) => b.scope === 'circuit').map((b) => (
                  <option key={b.key} value={b.key}>{b.label}</option>
                ))}
              </optgroup>
            </select>
            <input
              ref={inputRef}
              value={editText ?? active?.value ?? ''}
              placeholder="セルの文字（{{panel.name}} のような項目も入力できます）"
              onFocus={() => editText === null && setEditText(active?.value ?? '')}
              onChange={(e) => setEditText(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  commitEdit();
                  gridRef.current?.focus();
                  move(1, 0, false);
                } else if (e.key === 'Escape') {
                  setEditText(null);
                  gridRef.current?.focus();
                }
              }}
            />
          </div>

          {(warnings.length > 0 || overflow > 0) && (
            <div className="warn">
              {overflow > 0 && <div>表の幅が用紙の印刷範囲より {overflow}mm 広いです（列幅か余白を調整してください）。</div>}
              {warnings.map((w) => <div key={w}>{w}</div>)}
            </div>
          )}

          <div
            className="editor-grid"
            ref={gridRef}
            tabIndex={0}
            onKeyDown={onGridKey}
            onCopy={onCopy}
            onCut={onCut}
            onPaste={onPaste}
          >
            <table style={{ width: sheetWidthMm(sheet) * px + 40 }}>
              <colgroup>
                <col style={{ width: 40 }} />
                {sheet.colWidthsMm.map((w, c) => <col key={c} style={{ width: w * px }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th className="corner" />
                  {sheet.colWidthsMm.map((w, c) => (
                    <th
                      key={c}
                      className={`col-head ${c >= sel.c1 && c <= sel.c2 ? 'sel' : ''}`}
                      onMouseDown={(e) => {
                        setAnchor({ r: 0, c: e.shiftKey ? anchor.c : c });
                        setFocus({ r: rows - 1, c });
                        gridRef.current?.focus();
                      }}
                      title={`${w}mm`}
                    >
                      {colName(c)}
                      <span
                        className="resize-col"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          startResize('col', c, e.clientX);
                        }}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rowHeightsMm.map((h, r) => {
                  const isRepeat = rr && r >= rr.rowStart && r <= rr.rowEnd;
                  const isHead = rh && r >= rh[0] && r <= rh[1];
                  return (
                    <tr key={r} style={{ height: h * px }}>
                      <th
                        className={`row-head ${r >= sel.r1 && r <= sel.r2 ? 'sel' : ''} ${isRepeat ? 'repeat' : ''} ${isHead ? 'head' : ''}`}
                        title={`${h}mm${isRepeat ? '／回路行（回路の数だけ繰り返す）' : ''}${isHead ? '／見出し行（改ページで繰り返す）' : ''}`}
                        onMouseDown={(e) => {
                          setAnchor({ r: e.shiftKey ? anchor.r : r, c: 0 });
                          setFocus({ r, c: cols - 1 });
                          gridRef.current?.focus();
                        }}
                      >
                        {r + 1}
                        {isRepeat && <span className="tag">回路</span>}
                        {isHead && <span className="tag">見出</span>}
                        <span
                          className="resize-row"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            startResize('row', r, e.clientY);
                          }}
                        />
                      </th>
                      {sheet.colWidthsMm.map((_, c) => {
                        const k = `${r},${c}`;
                        if (covered.has(k)) return null;
                        const m = mergeStart.get(k);
                        const cell = sheet.cells[k];
                        const isActive = r === anchor.r && c === anchor.c;
                        return (
                          <td
                            key={c}
                            rowSpan={m ? m.r2 - m.r1 + 1 : undefined}
                            colSpan={m ? m.c2 - m.c1 + 1 : undefined}
                            className={`${inSel(r, c) ? 'sel' : ''} ${isActive ? 'active' : ''} ${cell?.value?.includes('{{') ? 'bound' : ''}`}
                            style={cellStyle(cell)}
                            onMouseDown={(e) => {
                              if (editText !== null) commitEdit();
                              dragging.current = true;
                              select(r, c, e.shiftKey);
                              gridRef.current?.focus();
                            }}
                            onMouseEnter={() => dragging.current && setFocus({ r, c })}
                            onDoubleClick={() => {
                              setEditText(cell?.value ?? '');
                              setTimeout(() => inputRef.current?.focus(), 0);
                            }}
                          >
                            <div className="cv">{cell?.value ?? ''}</div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            操作: クリック／ドラッグ／Shift+矢印で範囲選択、文字を打つ・Enter・F2・ダブルクリックで編集、Delete で消去、Ctrl+C / Ctrl+V でコピー・貼り付け（Excel からの貼り付けは文字のみ）、Ctrl+Z / Ctrl+Y で元に戻す・やり直し。
            列見出しの右端・行番号の下端をドラッグすると幅・高さを変えられます。
            <span className="bound-sample">青字</span> = 報告書のデータが入る項目。行番号の「回路」= 回路の数だけ繰り返す行、「見出」= 改ページ時に繰り返す見出し行。
          </p>
        </>
      )}
    </div>
  );
}

function PageSetup({ sheet, commit }: { sheet: Sheet; commit: (s: Sheet) => void }) {
  const p = sheet.page;
  const area = printableArea(sheet);
  const setMargin = (k: 't' | 'r' | 'b' | 'l', v: number) =>
    Number.isFinite(v) && v >= 0 && commit({ ...sheet, page: { ...p, marginsMm: { ...p.marginsMm, [k]: v } } });
  return (
    <div className="group">
      <select value={p.size} onChange={(e) => commit({ ...sheet, page: { ...p, size: e.target.value as 'A4' | 'A3' } })}>
        <option>A4</option>
        <option>A3</option>
      </select>
      <select value={p.orientation} onChange={(e) => commit({ ...sheet, page: { ...p, orientation: e.target.value as 'portrait' | 'landscape' } })}>
        <option value="portrait">縦</option>
        <option value="landscape">横</option>
      </select>
      余白[mm]
      {(['t', 'b', 'l', 'r'] as const).map((k) => (
        <label key={k} className="inline">
          {{ t: '上', b: '下', l: '左', r: '右' }[k]}
          <input type="number" min={0} max={50} value={p.marginsMm[k]} onChange={(e) => setMargin(k, Number(e.target.value))} />
        </label>
      ))}
      <span className="muted">印刷幅 {Math.round(area.w)}mm／表の幅 {Math.round(sheetWidthMm(sheet) * 10) / 10}mm</span>
    </div>
  );
}
