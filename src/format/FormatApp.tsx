/**
 * 書式エディタ単体版。サーバー・インストール不要で、HTML ファイルを開くだけで使える。
 * 書式（レイアウト）を作り、Excel（空欄の様式）・PDF（空欄の様式）・書式データ（JSON）として保存する。
 * 作業内容はブラウザに自動保存する（消えた場合に備えて、JSON での保存をおすすめします）。
 */
import { useEffect, useRef, useState } from 'react';
import { blankForm } from '../domain/blankForm.ts';
import { sheetToXlsx } from '../domain/excel.ts';
import { generateSheet } from '../domain/generate.ts';
import { renderSheetHtml } from '../domain/renderHtml.ts';
import { SheetSchema, TemplateSchema, type Sheet } from '../shared/schema.ts';
import { SAMPLE_REPORT } from '../client/sampleReport.ts';
import { SheetEditor } from '../client/SheetEditor.tsx';
import defaultTemplate from '../../templates/default.json';

const STORAGE_KEY = 'format-editor-v1';

const DEFAULT_SHEET = TemplateSchema.parse(defaultTemplate).sheet;

/** 白紙（A4 縦、10列×20行） */
const BLANK_SHEET: Sheet = {
  page: { size: 'A4', orientation: 'portrait', marginsMm: { t: 10, r: 10, b: 10, l: 10 } },
  colWidthsMm: Array<number>(10).fill(19),
  rowHeightsMm: Array<number>(20).fill(8),
  cells: {},
  merges: [],
  images: [],
};

function loadSaved(): Sheet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = SheetSchema.safeParse(JSON.parse(raw));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

function saveLocal(sheet: Sheet) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sheet));
  } catch {
    /* 保存できない環境では何もしない */
  }
}

function downloadBlob(data: BlobPart | Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 印刷ダイアログを開く（「PDF として保存」を選んでもらう） */
function printHtml(html: string) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  iframe.srcdoc = html;
  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => iframe.remove(), 60_000);
    }, 300);
  };
  document.body.appendChild(iframe);
}

const asksRows = (): number | null => {
  const v = prompt('回路行（表の明細行）の数を入力してください', '20');
  if (v === null) return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > 500) {
    alert('1〜500 の数を入力してください。');
    return null;
  }
  return n;
};

export function FormatApp() {
  const [initial, setInitial] = useState<{ sheet: Sheet; key: number }>(() => ({ sheet: loadSaved() ?? DEFAULT_SHEET, key: 0 }));
  const [note, setNote] = useState('');
  const latest = useRef<Sheet>(initial.sheet);
  const fileRef = useRef<HTMLInputElement>(null);

  // 自動保存（ブラウザ内）
  useEffect(() => {
    const t = setInterval(() => saveLocal(latest.current), 3000);
    return () => clearInterval(t);
  }, []);

  const replace = (sheet: Sheet, msg: string) => {
    if (!confirm('いま編集中の内容は破棄されます。よろしいですか？（先に「書式データを保存」しておくと安全です）')) return;
    latest.current = sheet;
    setInitial((f) => ({ sheet, key: f.key + 1 }));
    setNote(msg);
  };

  const onOpen = async (file: File) => {
    try {
      const json = JSON.parse(await file.text());
      // テンプレート形式（{id,name,sheet}）と、Sheet だけの形式の両方を受け付ける
      const sheet = SheetSchema.parse(json.sheet ?? json);
      replace(sheet, `「${file.name}」を開きました`);
    } catch (e) {
      alert(`書式データとして読み込めませんでした: ${(e as Error).message.slice(0, 200)}`);
    }
  };

  const withLatest = (fn: (s: Sheet) => void | Promise<void>) => async (sheet: Sheet) => {
    latest.current = sheet;
    saveLocal(sheet);
    await fn(sheet);
  };

  return (
    <div className="app format-app">
      <header className="topbar">
        <span className="brand">書式エディタ（絶縁抵抗測定報告書）</span>
        <nav>
          <a href="#" onClick={(e) => (e.preventDefault(), replace(DEFAULT_SHEET, '標準の書式を読み込みました'))}>標準の書式を読み込む</a>
          <a href="#" onClick={(e) => (e.preventDefault(), replace(BLANK_SHEET, '白紙から始めます'))}>白紙から作る</a>
          <a href="#" onClick={(e) => (e.preventDefault(), fileRef.current?.click())}>書式データ（JSON）を開く</a>
        </nav>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onOpen(f);
            e.target.value = '';
          }}
        />
      </header>
      <main>
        {note && <p className="info">{note}</p>}
        <SheetEditor
          key={initial.key}
          initial={initial.sheet}
          previewReport={SAMPLE_REPORT}
          hideSubtitleDirty
          subtitle="プレビューは見本データで表示します。Excel・PDF は空欄の様式で出力します。"
          renderPreview={async (sheet, report) => renderSheetHtml(generateSheet(sheet, report), { title: '書式プレビュー' })}
          actions={[
            {
              label: 'Excel で保存（空欄の様式）',
              primary: true,
              onClick: withLatest(async (sheet) => {
                const n = asksRows();
                if (n === null) throw new Error('取り消しました');
                const xlsx = await sheetToXlsx(blankForm(sheet, n), { colWidthMmPerChar: 1.85, title: '絶縁抵抗測定報告書' });
                downloadBlob(xlsx, '絶縁抵抗測定報告書_書式.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
              }),
            },
            {
              label: 'PDF で保存（空欄の様式）',
              onClick: withLatest((sheet) => {
                const n = asksRows();
                if (n === null) throw new Error('取り消しました');
                alert('印刷の画面が開きます。送信先（プリンター）を「PDF に保存」に変えて保存してください。');
                printHtml(renderSheetHtml(blankForm(sheet, n), { title: '絶縁抵抗測定報告書' }));
              }),
            },
            {
              label: '書式データを保存（JSON）',
              onClick: withLatest((sheet) => {
                const name = prompt('書式の名前', '標準（A4横）') ?? '';
                if (!name.trim()) throw new Error('取り消しました');
                const tpl = { id: `u-${crypto.randomUUID()}`, name: name.trim(), sheet };
                downloadBlob(JSON.stringify(tpl, null, 1), `書式データ_${name.trim().replace(/[\\/:*?"<>|]/g, '_')}.json`, 'application/json');
              }),
            },
          ]}
        />
      </main>
    </div>
  );
}
