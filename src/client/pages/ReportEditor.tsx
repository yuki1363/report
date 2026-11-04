import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { autoGroundVoltage, DEFAULT_USE_VOLTAGE } from '../../domain/groundVoltage.ts';
import { defaultTestVoltage } from '../../domain/importing.ts';
import { newCircuit } from '../../domain/newCircuit.ts';
import { parseVoltage } from '../../domain/system.ts';
import { applyFreeVoltage, applySystem, patternOf, VOLTAGE_PATTERNS, voltageText } from '../../domain/voltagePattern.ts';
import { isLowVoltage, LOW_VOLTAGE_MAX_V } from '../../domain/judgment.ts';
import { judgeCircuit, VERDICT_LABEL, type Verdict } from '../../domain/judgment.ts';
import { formatReading, parseReading } from '../../domain/reading.ts';
import {
  READING_KEYS,
  READING_LABELS,
  TEST_VOLTAGES,
  SELECTABLE_SYSTEMS,
  type Circuit,
  type ReadingKey,
  type Report,
  type Sheet,
  type WiringSystem,
} from '../../shared/schema.ts';
import { api, type TemplateSummary } from '../api.ts';
import { MeggerDialog } from '../MeggerDialog.tsx';
import { PasteDialog } from '../PasteDialog.tsx';
import type { PastedCircuit } from '../../domain/pasteCircuits.ts';
import { SheetEditor } from '../SheetEditor.tsx';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

const newId = () => crypto.randomUUID();

/** 数値入力の解析。全角可。「105/210」のように書かれたら大きい方（使用電圧用） */
const optNum = (s: string): number | undefined => {
  const n = parseVoltage(s);
  return n === undefined || Number.isNaN(n) ? undefined : n;
};

export function ReportEditor({ id }: { id: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [tab, setTab] = useState<'input' | 'format' | 'preview'>('input');
  const [previewKey, setPreviewKey] = useState(0);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [outBusy, setOutBusy] = useState('');
  const [formatSheet, setFormatSheet] = useState<{ sheet: Sheet; key: number } | null>(null);
  const [formatDirty, setFormatDirty] = useState(false);
  const [megger, setMegger] = useState<{ row: number; key: ReadingKey } | null>(null);
  const [pasting, setPasting] = useState(false);
  const lastCell = useRef<{ row: number; key: ReadingKey }>({ row: 0, key: 'RE' });
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef<Report | null>(null);
  /** 保存は直列に実行する（古い保存が新しい保存を上書きしないように） */
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    api
      .getReport(id)
      .then((r) => {
        setReport(r);
        latest.current = r;
      })
      .catch((e: Error) => setError(e.message));
    api
      .getSettings()
      .then((s) => {
        setAiEnabled(s.settings.aiExtraction);
      })
      .catch(() => {});
    api.listTemplates().then(setTemplates).catch(() => {});
  }, [id]);

  const flush = useCallback((): Promise<void> => {
    clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    saveChain.current = saveChain.current.then(async () => {
      const r = latest.current;
      if (!r) return;
      setSaveState('saving');
      try {
        await api.saveReport(r);
        setSaveState(latest.current === r ? 'saved' : 'dirty');
        setError('');
      } catch (e) {
        setSaveState('error');
        setError(`保存できませんでした: ${(e as Error).message}`);
      }
    });
    return saveChain.current;
  }, []);

  // 画面を離れる前に保存
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (saveTimer.current) {
        void flush();
        e.preventDefault();
      }
    };
    addEventListener('beforeunload', before);
    return () => {
      removeEventListener('beforeunload', before);
      if (saveTimer.current) void flush();
    };
  }, [flush]);

  const update = (fn: (r: Report) => Report) => {
    setReport((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      latest.current = next;
      return next;
    });
    setSaveState('dirty');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), 600);
  };

  const updateCircuit = (cid: string, fn: (c: Circuit) => Circuit) =>
    update((r) => ({ ...r, circuits: r.circuits.map((c) => (c.id === cid ? fn(c) : c)) }));

  const addCircuit = (afterIndex?: number) =>
    update((r) => {
      const idx = afterIndex ?? r.circuits.length - 1;
      const c = newCircuit(r.circuits[idx]);
      const circuits = [...r.circuits];
      circuits.splice(idx + 1, 0, c);
      return { ...r, circuits };
    });

  const removeCircuit = (cid: string) => update((r) => ({ ...r, circuits: r.circuits.filter((c) => c.id !== cid) }));

  const moveCircuit = (index: number, delta: number) =>
    update((r) => {
      const j = index + delta;
      if (j < 0 || j >= r.circuits.length) return r;
      const circuits = [...r.circuits];
      [circuits[index], circuits[j]] = [circuits[j]!, circuits[index]!];
      return { ...r, circuits };
    });

  if (error && !report) return <p className="error">{error}</p>;
  if (!report) return <p>読み込み中…</p>;

  const leaveFormat = () => !(tab === 'format' && formatDirty) || confirm('書式の変更が保存されていません。破棄して移動しますか？');

  const openPreview = async () => {
    if (!leaveFormat()) return;
    await flush();
    setPreviewKey((k) => k + 1);
    setTab('preview');
  };

  const loadFormatSheet = async (r: Report): Promise<Sheet> =>
    r.sheetOverride ?? (await api.getTemplate(r.templateId).catch(() => api.getTemplate('default'))).sheet;

  const openFormat = async () => {
    await flush();
    const sheet = await loadFormatSheet(latest.current ?? report);
    setFormatSheet((f) => ({ sheet, key: (f?.key ?? 0) + 1 }));
    setFormatDirty(false);
    setTab('format');
  };

  const output = async (kind: 'pdf' | 'xlsx') => {
    setOutBusy(kind);
    try {
      await flush();
      await (kind === 'pdf' ? api.downloadPdf(report.id) : api.downloadXlsx(report.id));
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setOutBusy('');
    }
  };

  const templateName = templates.find((t) => t.id === report.templateId)?.name ?? report.templateId;

  return (
    <section>
      <div className="toolbar">
        <a href="#/">← 一覧</a>
        <h1>{report.panel.name || '（盤名未入力）'}</h1>
        <span className={`save save-${saveState}`}>
          {{ saved: '保存済み', dirty: '未保存…', saving: '保存中…', error: '保存エラー' }[saveState]}
        </span>

        <div className="spacer" />
        <div className="tabs">
          <button className={tab === 'input' ? 'active' : ''} onClick={() => leaveFormat() && setTab('input')}>
            測定値入力
          </button>
          <button className={tab === 'format' ? 'active' : ''} onClick={() => tab !== 'format' && openFormat()}>
            書式編集
          </button>
          <button className={tab === 'preview' ? 'active' : ''} onClick={openPreview}>
            プレビュー
          </button>
        </div>
        <button className="primary" onClick={() => output('pdf')} disabled={Boolean(outBusy)}>
          {outBusy === 'pdf' ? 'PDF 作成中…' : 'PDF 出力'}
        </button>
        <button className="primary" onClick={() => output('xlsx')} disabled={Boolean(outBusy)}>
          {outBusy === 'xlsx' ? 'Excel 作成中…' : 'Excel 出力'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {tab === 'preview' ? (
        <div className="preview">
          <p className="muted">
            PDF と同じ HTML を表示しています。書式: {report.sheetOverride ? 'この報告書だけの書式' : `テンプレート「${templateName}」`}
          </p>
          <iframe key={previewKey} title="プレビュー" src={`/api/reports/${report.id}/html?v=${previewKey}`} />
        </div>
      ) : tab === 'format' && formatSheet ? (
        <SheetEditor
          key={formatSheet.key}
          initial={formatSheet.sheet}
          previewReport={report}
          onDirtyChange={setFormatDirty}
          subtitle={report.sheetOverride ? '編集中: この報告書だけの書式' : `編集中: テンプレート「${templateName}」をもとにした書式`}
          actions={[
            {
              label: 'この報告書だけに適用',
              primary: true,
              onClick: async (sheet) => {
                update((r) => ({ ...r, sheetOverride: sheet }));
                await flush();
              },
            },
            {
              label: 'テンプレートとして保存…',
              onClick: async (sheet) => {
                const name = prompt('テンプレートの名前（次回からの報告書作成で選べます）', `${report.panel.name || '新しい'}用の書式`);
                if (!name?.trim()) throw new Error('保存を取り消しました');
                const created = await api.createTemplate(name.trim(), sheet);
                setTemplates(await api.listTemplates());
                if (confirm(`テンプレート「${created.name}」を保存しました。\nこの報告書にも、このテンプレートを使いますか？`)) {
                  update((r) => {
                    const { sheetOverride: _s, ...rest } = r;
                    return { ...rest, templateId: created.id };
                  });
                  await flush();
                }
              },
            },
            ...(report.sheetOverride
              ? [
                  {
                    label: 'この報告書だけの書式を破棄',
                    onClick: async () => {
                      if (!confirm(`この報告書だけの書式を破棄して、テンプレート「${templateName}」に戻します。よろしいですか？`)) {
                        throw new Error('取り消しました');
                      }
                      const next = (() => {
                        const { sheetOverride: _s, ...rest } = latest.current ?? report;
                        return rest;
                      })();
                      update(() => next);
                      await flush();
                      const sheet = await loadFormatSheet(next);
                      setFormatSheet((f) => ({ sheet, key: (f?.key ?? 0) + 1 }));
                    },
                  },
                ]
              : []),
          ]}
        />
      ) : (
        <>
          <HeaderForm report={report} templates={templates} update={update} />
          <div className="toolbar sub">
            <button onClick={() => setPasting(true)} title="Excel などの表をコピーして、まとめて追加します">
              📋 回路を貼り付けて追加
            </button>
            <a className="button" href={`#/import/${report.id}`} onClick={() => void flush()}>
              📄 図面から回路を追加
            </a>
            <button
              onClick={() => setMegger({ ...lastCell.current, row: Math.min(lastCell.current.row, Math.max(0, report.circuits.length - 1)) })}
              disabled={report.circuits.length === 0}
              title="メガーの表示を撮った写真から測定値を読み取ります（実験的機能）"
            >
              📷 メガー写真から入力（実験的）
            </button>
          </div>
          {report.circuits.some((c) => !isLowVoltage(c.useVoltage)) && (
            <p className="warn">
              使用電圧が低圧（{LOW_VOLTAGE_MAX_V}V 以下）を超えている回路があります（{report.circuits.filter((c) => !isLowVoltage(c.useVoltage)).map((c) => c.no || c.name).join('、')}）。
              このアプリは低圧の絶縁抵抗測定だけが対象です。入力を確認してください。
            </p>
          )}
          <CircuitGrid
            circuits={report.circuits}
            updateCircuit={updateCircuit}
            addCircuit={addCircuit}
            removeCircuit={removeCircuit}
            moveCircuit={moveCircuit}
            onCellFocus={(row, key) => (lastCell.current = { row, key })}
          />
        </>
      )}
      {pasting && (
        <PasteDialog
          defaultVoltage={(() => { const l = report.circuits.at(-1); return (l && patternOf(l.useVoltage, l.voltageLabel)?.value) || '210'; })()}
          onClose={() => setPasting(false)}
          onApply={(list: PastedCircuit[]) => {
            update((r) => ({
              ...r,
              circuits: [
                ...r.circuits,
                ...list.map((c) => ({
                  id: newId(),
                  no: c.no,
                  name: c.name,
                  system: c.system,
                  ...(c.deviceType ? { deviceType: c.deviceType } : {}),
                  useVoltage: c.useVoltage,
                  ...(c.voltageLabel ? { voltageLabel: c.voltageLabel } : {}),
                  groundVoltage: c.system ? autoGroundVoltage(c.system, c.useVoltage) : 0,
                  testVoltage: defaultTestVoltage(c.useVoltage),
                  ...(c.breakerA !== undefined ? { breakerA: c.breakerA } : {}),
                  readings: {},
                  source: 'manual' as const,
                })),
              ],
            }));
            setPasting(false);
          }}
        />
      )}
      {megger && (
        <MeggerDialog
          circuits={report.circuits}
          initialRow={megger.row}
          initialKey={megger.key}
          aiEnabled={aiEnabled}
          onClose={() => setMegger(null)}
          onApply={(cid, key, reading) => {
            updateCircuit(cid, (x) => ({ ...x, readings: { ...x.readings, [key]: reading } }));
            setMegger(null);
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function HeaderForm({
  report,
  templates,
  update,
}: {
  report: Report;
  templates: TemplateSummary[];
  update: (fn: (r: Report) => Report) => void;
}) {
  return (
    <fieldset className="header-form">
      <legend>基本情報</legend>
      <label>
        書式テンプレート
        <select
          value={report.templateId}
          onChange={(e) => {
            const v = e.target.value;
            if (report.sheetOverride && !confirm('この報告書だけの書式は破棄され、選んだテンプレートの書式になります。よろしいですか？')) return;
            update((r) => {
              const { sheetOverride: _s, ...rest } = r;
              return { ...rest, templateId: v };
            });
          }}
        >
          {templates.length === 0 && <option value={report.templateId}>{report.templateId}</option>}
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {report.sheetOverride && <small>※この報告書だけの書式を使用中</small>}
      </label>
      <label>
        盤名
        <input value={report.panel.name} onChange={(e) => update((r) => ({ ...r, panel: { ...r.panel, name: e.target.value } }))} />
      </label>
      <label>
        設置場所
        <input
          value={report.panel.location ?? ''}
          onChange={(e) => update((r) => ({ ...r, panel: { ...r.panel, location: e.target.value } }))}
        />
      </label>
      <label>
        測定日（空欄でも可。カレンダーから選べます）
        <span className="row">
          <input type="date" value={report.date} onChange={(e) => update((r) => ({ ...r, date: e.target.value }))} />
          {report.date && (
            <button type="button" title="測定日を空欄に戻す" onClick={() => update((r) => ({ ...r, date: '' }))}>
              消す
            </button>
          )}
        </span>
      </label>
      <label className="short">
        温度[℃]
        <NumInput value={report.tempC} onChange={(v) => update((r) => withOpt(r, 'tempC', v))} />
      </label>
      <label className="short">
        湿度[%]
        <NumInput value={report.humidity} onChange={(v) => update((r) => withOpt(r, 'humidity', v))} />
      </label>
      <label className="wide">
        備考（帳票の備考欄に出ます）
        <textarea
          rows={3}
          value={report.note ?? ''}
          onChange={(e) =>
            update((r) => {
              const { note: _n, ...rest } = r;
              return e.target.value ? { ...rest, note: e.target.value } : rest;
            })
          }
        />
      </label>
    </fieldset>
  );
}

function withOpt<K extends 'tempC' | 'humidity'>(r: Report, k: K, v: number | undefined): Report {
  const next = { ...r };
  if (v === undefined) delete next[k];
  else next[k] = v;
  return next;
}

function NumInput({
  value,
  onChange,
  className,
  ...rest
}: { value: number | undefined; onChange: (v: number | undefined) => void; className?: string } & Record<string, unknown>) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value === undefined ? '' : String(value));
  }, [value]);
  const invalid = text.trim() !== '' && optNum(text) === undefined;
  return (
    <input
      {...rest}
      inputMode="decimal"
      className={`${className ?? ''} ${invalid ? 'invalid' : ''}`}
      value={text}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        setText(value === undefined ? '' : String(value));
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = optNum(e.target.value);
        if (e.target.value.trim() === '' || n !== undefined) onChange(n);
      }}
    />
  );
}

/**
 * 使用電圧の入力欄。自由に書ける（候補: 105 / 105/210 / 210 / 440）。
 * 候補のどれかを書くと、電気方式も連動して決まる。それ以外（200V・100/200 など）は書いたとおりに帳票へ出す。
 * 空欄にすると、電気方式も空欄になる。確定は、欄から出たとき（Tab・クリック）か Enter。
 */
function VoltageInput({
  circuit,
  onCommit,
  className,
  ...rest
}: { circuit: Circuit; onCommit: (text: string) => void; className?: string } & Record<string, unknown>) {
  const shown = voltageText(circuit);
  const [text, setText] = useState(shown);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  const v = parseVoltage(text);
  const invalid = text.trim() !== '' && (v === undefined || Number.isNaN(v) || v <= 0);
  return (
    <input
      {...rest}
      className={`${className ?? ''} ${invalid ? 'invalid' : ''}`}
      list="voltage-list"
      value={text}
      title="自由に書けます（例: 105/210、200、100/200V）。候補の 105 / 105/210 / 210 / 440 を書くと、電気方式も連動します。空欄にすると電気方式も空欄になります"
      onFocus={(e) => {
        focused.current = true;
        e.target.select();
      }}
      onBlur={() => {
        focused.current = false;
        if (text !== shown) onCommit(text);
        else setText(shown);
      }}
      onKeyDown={(e) => {
        // Enter で確定してから、表の移動（下の行へ）に渡す
        if (e.key === 'Enter' && text !== shown) onCommit(text);
      }}
      onChange={(e) => setText(e.target.value)}
    />
  );
}

function ReadingInput({
  value,
  onChange,
  ...rest
}: {
  value: Circuit['readings'][ReadingKey];
  onChange: (v: Circuit['readings'][ReadingKey]) => void;
} & Record<string, unknown>) {
  const [text, setText] = useState(formatReading(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(formatReading(value));
  }, [value]);
  const invalid = parseReading(text) === null;
  return (
    <input
      {...rest}
      className={`reading ${invalid ? 'invalid' : ''}`}
      value={text}
      title="数値 / >2000（上限超過）/ -（測定対象外）"
      onFocus={(e) => {
        focused.current = true;
        e.target.select();
      }}
      onBlur={() => {
        focused.current = false;
        setText(formatReading(value));
      }}
      onChange={(e) => {
        setText(e.target.value);
        const p = parseReading(e.target.value);
        if (p !== null) onChange(p);
      }}
    />
  );
}

// ---------------------------------------------------------------------------

const COLS = ['no', 'name', 'deviceType', 'breakerA', 'system', 'useVoltage', 'groundVoltage', 'testVoltage', ...READING_KEYS, 'note'] as const;

function CircuitGrid({
  circuits,
  updateCircuit,
  addCircuit,
  removeCircuit,
  moveCircuit,
  onCellFocus,
}: {
  circuits: Circuit[];
  updateCircuit: (id: string, fn: (c: Circuit) => Circuit) => void;
  addCircuit: (afterIndex?: number) => void;
  removeCircuit: (id: string) => void;
  moveCircuit: (index: number, delta: number) => void;
  onCellFocus: (row: number, key: ReadingKey) => void;
}) {
  const gridRef = useRef<HTMLTableElement>(null);
  /** 対地電圧・測定電圧は帳票に載せないため既定では隠す（対地電圧は判定の基準値に内部で使う） */
  const [showVolt, setShowVolt] = useState(false);
  const pendingFocus = useRef<{ row: number; col: number } | null>(null);

  const focusCell = (row: number, col: number) => {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
    if (el) {
      el.focus();
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (pendingFocus.current && focusCell(pendingFocus.current.row, pendingFocus.current.col)) pendingFocus.current = null;
  });

  /**
   * キーボード操作:
   *  Enter / ↓ : 下の行へ（最終行で Enter → 回路を追加）
   *  Shift+Enter / ↑ : 上の行へ
   *  Tab / Shift+Tab : 左右（ブラウザ標準）
   */
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    const row = Number(t.dataset.row);
    const col = Number(t.dataset.col);
    if (Number.isNaN(row)) return;
    const isSelect = t.tagName === 'SELECT';
    let target: number | null = null;
    if (e.key === 'Enter') target = e.shiftKey ? row - 1 : row + 1;
    else if (!isSelect && e.key === 'ArrowDown') target = row + 1;
    else if (!isSelect && e.key === 'ArrowUp') target = row - 1;
    if (target === null) return;
    e.preventDefault();
    if (target < 0) return;
    if (target >= circuits.length) {
      if (e.key !== 'Enter') return;
      pendingFocus.current = { row: target, col };
      addCircuit();
      return;
    }
    focusCell(target, col);
  };

  const cellProps = (row: number, col: (typeof COLS)[number]) => ({
    'data-row': row,
    'data-col': COLS.indexOf(col),
    onKeyDown,
  });

  return (
    <div className="grid-wrap">
      <datalist id="voltage-list">
        {VOLTAGE_PATTERNS.map((p) => (
          <option key={p.value} value={p.value} />
        ))}
      </datalist>
      <datalist id="device-types">
        {['ELB', 'MCB', 'Mg', 'MCCB', 'NFB', 'ELCB'].map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      <table
        className="grid"
        ref={gridRef}
        onFocusCapture={(e) => {
          const t = e.target as HTMLElement;
          const row = Number(t.dataset.row);
          const col = COLS[Number(t.dataset.col)];
          if (!Number.isNaN(row) && col && (READING_KEYS as readonly string[]).includes(col)) onCellFocus(row, col as ReadingKey);
        }}
      >
        <thead>
          <tr>
            <th rowSpan={2}>No</th>
            <th rowSpan={2}>回路名称</th>
            <th rowSpan={2} title="ELB・MCB・Mg など（自由に書けます）">種別</th>
            <th rowSpan={2}>容量[A]</th>
            <th rowSpan={2}>電気方式</th>
            <th rowSpan={2}>使用電圧[V]</th>
            {showVolt && <th rowSpan={2} title="判定の基準値（0.1 / 0.2 MΩ）の決定に使います">対地電圧[V]</th>}
            {showVolt && <th rowSpan={2}>測定電圧[V]</th>}
            <th colSpan={READING_KEYS.length}>絶縁抵抗値 [MΩ]</th>
            <th rowSpan={2}>基準値</th>
            <th rowSpan={2}>判定</th>
            <th rowSpan={2}>備考</th>
            <th rowSpan={2} className="sticky-actions">操作</th>
          </tr>
          <tr>
            {READING_KEYS.map((k) => (
              <th key={k}>{READING_LABELS[k]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {circuits.map((c, i) => {
            const j = judgeCircuit(c);
            const auto = c.system ? autoGroundVoltage(c.system, c.useVoltage) : 0;
            return (
              <tr key={c.id}>
                <td>
                  <input className="no" value={c.no} {...cellProps(i, 'no')} onChange={(e) => updateCircuit(c.id, (x) => ({ ...x, no: e.target.value }))} />
                </td>
                <td>
                  <input className="name" value={c.name} {...cellProps(i, 'name')} onChange={(e) => updateCircuit(c.id, (x) => ({ ...x, name: e.target.value }))} />
                </td>
                <td>
                  <input
                    className="dev"
                    list="device-types"
                    value={c.deviceType ?? ''}
                    {...cellProps(i, 'deviceType')}
                    onChange={(e) =>
                      updateCircuit(c.id, (x) => {
                        const { deviceType: _d, ...rest } = x;
                        return e.target.value ? { ...rest, deviceType: e.target.value } : rest;
                      })
                    }
                  />
                </td>
                <td>
                  <NumInput
                    className="volt"
                    value={c.breakerA}
                    {...cellProps(i, 'breakerA')}
                    onChange={(v) =>
                      updateCircuit(c.id, (x) => {
                        const { breakerA: _b, ...rest } = x;
                        return v === undefined ? rest : { ...rest, breakerA: v };
                      })
                    }
                  />
                </td>
                <td>
                  <select
                    value={c.system}
                    {...cellProps(i, 'system')}
                    onChange={(e) => updateCircuit(c.id, (x) => applySystem(x, e.target.value as WiringSystem | ''))}
                  >
                    <option value="">（空欄）</option>
                    {c.system === '3φ4W' && <option>3φ4W</option>}
                    {SELECTABLE_SYSTEMS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <VoltageInput
                    className={`volt ${isLowVoltage(c.useVoltage) ? '' : 'invalid'}`}
                    circuit={c}
                    {...cellProps(i, 'useVoltage')}
                    onCommit={(text) => updateCircuit(c.id, (x) => applyFreeVoltage(x, text))}
                  />
                </td>
                {showVolt && (
                  <>
                <td>
                  <NumInput
                    className={`volt ${c.groundVoltage !== auto ? 'manual' : ''}`}
                    value={c.groundVoltage}
                    title={c.groundVoltage !== auto ? `手動上書き（自動算出値: ${auto}V）` : '電気方式と使用電圧から自動算出'}
                    {...cellProps(i, 'groundVoltage')}
                    onChange={(v) => updateCircuit(c.id, (x) => ({ ...x, groundVoltage: v ?? 0 }))}
                  />
                </td>
                <td>
                  <select
                    value={c.testVoltage}
                    {...cellProps(i, 'testVoltage')}
                    onChange={(e) => updateCircuit(c.id, (x) => ({ ...x, testVoltage: Number(e.target.value) as Circuit['testVoltage'] }))}
                  >
                    {TEST_VOLTAGES.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </td>
                  </>
                )}
                {READING_KEYS.map((k) => (
                  <td key={k}>
                    <ReadingInput
                      value={c.readings[k]}
                      {...cellProps(i, k)}
                      onChange={(v) =>
                        updateCircuit(c.id, (x) => {
                          const readings = { ...x.readings };
                          if (v === undefined) delete readings[k];
                          else readings[k] = v;
                          return { ...x, readings };
                        })
                      }
                    />
                  </td>
                ))}
                <td className="num" title={j.criterion.label}>
                  {j.criterion.mohm}
                </td>
                <td>
                  <VerdictBadge v={j.verdict} />
                </td>
                <td>
                  <input className="note" value={c.note ?? ''} {...cellProps(i, 'note')} onChange={(e) => updateCircuit(c.id, (x) => ({ ...x, note: e.target.value }))} />
                </td>
                <td className="row-actions sticky-actions">
                  <button tabIndex={-1} title="上へ" onClick={() => moveCircuit(i, -1)}>
                    ↑
                  </button>
                  <button tabIndex={-1} title="下へ" onClick={() => moveCircuit(i, 1)}>
                    ↓
                  </button>
                  <button tabIndex={-1} title="この下に行を挿入" onClick={() => addCircuit(i)}>
                    ＋
                  </button>
                  <button
                    tabIndex={-1}
                    className="danger"
                    title="この回路を削除"
                    onClick={() => confirm(`回路「${c.no} ${c.name}」を削除しますか？`) && removeCircuit(c.id)}
                  >
                    削除
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="grid-footer">
        <button onClick={() => addCircuit()}>＋ 回路を追加</button>
        <label className="check inline-check" title="帳票には載りません。判定の基準値（0.1 / 0.2 MΩ）は、電気方式と使用電圧から自動で決まります">
          <input type="checkbox" checked={showVolt} onChange={(e) => setShowVolt(e.target.checked)} /> 対地電圧・測定電圧を表示（通常は不要）
        </label>
        <span className="muted">
          入力: 数値 ／ 「&gt;2000」= 上限超過 ／ 「-」= 測定対象外。Enter・↑↓ で上下移動、最終行で Enter → 行追加。
          
        </span>
      </div>
    </div>
  );
}

function VerdictBadge({ v }: { v: Verdict }) {
  if (v === 'none') return null; // 判定していない回路は空欄
  return <span className={`verdict v-${v}`}>{VERDICT_LABEL[v]}</span>;
}
