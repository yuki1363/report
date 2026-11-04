import { useEffect, useRef, useState, type DragEvent } from 'react';
import { api } from '../api.ts';
import { ACCEPT, isSupported, processImage, processPdf, type ProcessedPage } from '../fileProcessing.ts';
import { navigate } from '../nav.ts';

/** 取込画面（PDF・画像のドラッグ&ドロップ、複数ファイル可）。#/import 又は #/import/<報告書ID> */
export function ImportPage({ targetReportId }: { targetReportId?: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const [targetName, setTargetName] = useState<string | null>(null);
  const [ai, setAi] = useState<{ on: boolean; key: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (targetReportId) api.getReport(targetReportId).then((r) => setTargetName(r.panel.name || '（盤名未入力）')).catch((e: Error) => setError(e.message));
    api.getSettings().then((s) => setAi({ on: s.settings.aiExtraction, key: s.apiKeyConfigured })).catch(() => {});
  }, [targetReportId]);

  const add = (list: FileList | File[]) => {
    const arr = [...list];
    const bad = arr.filter((f) => !isSupported(f));
    if (bad.length) setError(`対応していない形式です（PDF・PNG・JPEG のみ）: ${bad.map((f) => f.name).join('、')}`);
    else setError('');
    setFiles((prev) => [...prev, ...arr.filter(isSupported)]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    add(e.dataTransfer.files);
  };

  const start = async () => {
    setError('');
    try {
      const pages: ProcessedPage[] = [];
      for (const [i, f] of files.entries()) {
        if (f.type === 'application/pdf') {
          pages.push(...(await processPdf(f, i, (n, total) => setBusy(`「${f.name}」を画像化しています（${n}/${total}ページ）`))));
        } else {
          setBusy(`「${f.name}」を処理しています`);
          pages.push(await processImage(f, i));
        }
      }
      setBusy('アップロードしています');
      const fd = new FormData();
      files.forEach((f) => fd.append('source', f, f.name));
      pages.forEach((p, i) => fd.append('page', p.blob, `page-${i}`));
      fd.append('meta', JSON.stringify(pages.map((p) => p.meta)));
      if (targetReportId) fd.append('targetReportId', targetReportId);
      const rec = await api.uploadImport(fd);
      navigate(`/imports/${rec.id}?auto=1`);
    } catch (e) {
      setError(`取り込めませんでした: ${(e as Error).message}`);
      setBusy('');
    }
  };

  return (
    <section className="import">
      <div className="toolbar">
        <a href={targetReportId ? `#/reports/${targetReportId}` : '#/'}>← 戻る</a>
        <h1>{targetReportId ? `図面から回路を追加（${targetName ?? '…'}）` : '図面から報告書を作成'}</h1>
      </div>

      {ai && (
        <p className={ai.on ? 'info' : 'warn'}>
          {ai.on
            ? ai.key
              ? '外部 AI（Claude API）で読み取ります。資料は Anthropic のサーバーに送信されます。'
              : '外部 AI 読み取りは ON ですが、API キーが未設定です（.env の ANTHROPIC_API_KEY）。'
            : '外部 AI 読み取りは OFF です。オフライン読み取り（OCR）を使います。図面の読み取り精度は低いため、補助としてお使いください。'}
        </p>
      )}

      <div
        className={`dropzone ${drag ? 'drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      >
        <p>
          <strong>PDF・画像（JPG / PNG）をここにドラッグ&ドロップ</strong>
        </p>
        <p className="muted">またはクリックしてファイルを選択（複数可）。単線結線図・盤図面の PDF、銘板や回路名称表示の写真など。</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              {f.type === 'application/pdf' ? '📄' : '🖼'} {f.name}（{(f.size / 1024 / 1024).toFixed(1)} MB）
              <button disabled={Boolean(busy)} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                取り消し
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
      <div className="toolbar">
        <button className="primary" disabled={files.length === 0 || Boolean(busy)} onClick={start}>
          読み取り開始
        </button>
        {busy && <span className="busy">{busy}…</span>}
      </div>
      <p className="muted">読み取った内容は、次の確認・修正画面で確定するまで報告書には反映されません。</p>
    </section>
  );
}
