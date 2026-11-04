/**
 * P4（実験的）: メガー（絶縁抵抗計）表示写真の読み取り。
 * 読み取った値は「候補」として表示し、利用者が「反映」を押した時だけ入力する。
 */
import { useState } from 'react';
import { formatReading } from '../domain/reading.ts';
import { READING_KEYS, READING_LABELS, type Circuit, type Reading, type ReadingKey } from '../shared/schema.ts';
import { api, type MeggerReading } from './api.ts';
import { MAX_SIDE } from './fileProcessing.ts';

async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('画像の変換に失敗しました'))), 'image/jpeg', 0.9));
}

export function MeggerDialog({
  circuits,
  initialRow,
  initialKey,
  aiEnabled,
  onApply,
  onClose,
}: {
  circuits: Circuit[];
  initialRow: number;
  initialKey: ReadingKey;
  aiEnabled: boolean;
  onApply: (circuitId: string, key: ReadingKey, reading: Reading) => void;
  onClose: () => void;
}) {
  const [row, setRow] = useState(initialRow);
  const [key, setKey] = useState<ReadingKey>(initialKey);
  const [photo, setPhoto] = useState<string | null>(null);
  const [result, setResult] = useState<MeggerReading | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const c = circuits[row];

  const read = async (file: File) => {
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const blob = await shrink(file);
      setPhoto(URL.createObjectURL(blob));
      const fd = new FormData();
      fd.append('image', blob, 'megger.jpg');
      setResult(await api.readMegger(fd));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const candidate: Reading | null =
    result && result.kind !== 'unreadable' && result.mohm !== null ? { kind: result.kind, mohm: result.mohm } : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="メガー写真から入力">
        <h2>メガー写真から入力（実験的機能）</h2>
        {!aiEnabled ? (
          <p className="warn">外部 AI 読み取りが OFF のため使えません（設定画面で ON にすると使えます。写真は Anthropic のサーバーに送信されます）。</p>
        ) : (
          <>
            <p className="warn small">読み取り結果は誤っている可能性があります。必ず写真と見比べてから反映してください。</p>
            <div className="row">
              <label>
                回路
                <select value={row} onChange={(e) => setRow(Number(e.target.value))}>
                  {circuits.map((x, i) => (
                    <option key={x.id} value={i}>
                      {x.no} {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                測定箇所
                <select value={key} onChange={(e) => setKey(e.target.value as ReadingKey)}>
                  {READING_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {READING_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                写真
                <input type="file" accept="image/jpeg,image/png" capture="environment" disabled={busy} onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
              </label>
            </div>
            {busy && <p className="busy">読み取っています…</p>}
            {error && <p className="error">{error}</p>}
            <div className="megger-result">
              {photo && <img src={photo} alt="メガーの表示" />}
              {result && (
                <div>
                  <p>
                    表示: <strong>{result.displayText ?? '（読めません）'}</strong>
                  </p>
                  <p>
                    候補値: <strong className="big">{candidate ? `${formatReading(candidate)} MΩ` : '読み取れませんでした'}</strong>
                  </p>
                  {result.reason && <p className="unc">要確認: {result.reason}</p>}
                  {c?.readings[key] && <p className="muted">現在の値: {formatReading(c.readings[key])}（上書きされます）</p>}
                </div>
              )}
            </div>
          </>
        )}
        <div className="toolbar">
          <div className="spacer" />
          <button onClick={onClose}>閉じる</button>
          <button className="primary" disabled={!candidate || !c} onClick={() => c && candidate && onApply(c.id, key, candidate)}>
            {c ? `「${c.no} ${c.name}」の ${READING_LABELS[key]} に反映` : '反映'}
          </button>
        </div>
      </div>
    </div>
  );
}
