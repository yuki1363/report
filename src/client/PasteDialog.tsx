/** 回路をまとめて貼り付けて追加する（Excel などからコピーした表をそのまま貼れる） */
import { useMemo, useState } from 'react';
import { parsePastedCircuits, type PastedCircuit } from '../domain/pasteCircuits.ts';
import { WIRING_SYSTEMS, type WiringSystem } from '../shared/schema.ts';

export function PasteDialog({
  defaultSystem,
  defaultVoltage,
  onApply,
  onClose,
}: {
  defaultSystem: WiringSystem;
  defaultVoltage: number;
  onApply: (circuits: PastedCircuit[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [system, setSystem] = useState<WiringSystem>(defaultSystem);
  const [volt, setVolt] = useState(String(defaultVoltage));
  const v = Number(volt.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  const voltOk = Number.isFinite(v) && v > 0;
  const result = useMemo(() => parsePastedCircuits(text, { system, useVoltage: voltOk ? v : 100 }), [text, system, v, voltOk]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="回路を貼り付けて追加">
        <h2>回路を貼り付けて追加</h2>
        <p className="muted small">
          Excel などの表をコピーして、下の欄に貼り付けてください。列の順は
          <strong>「回路No ／ 回路名称 ／ 電気方式 ／ 使用電圧 ／ ブレーカ容量(AT)」</strong>です。
          電気方式・使用電圧・ブレーカ容量は空欄や列なしでも構いません（空欄は下の既定値を使います）。名称だけの貼り付けも可能です（番号は自動）。
        </p>
        <div className="row">
          <label>
            既定の電気方式
            <select value={system} onChange={(e) => setSystem(e.target.value as WiringSystem)}>
              {WIRING_SYSTEMS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            既定の使用電圧[V]
            <input value={volt} inputMode="decimal" className={voltOk ? '' : 'invalid'} onChange={(e) => setVolt(e.target.value)} />
          </label>
        </div>
        <textarea
          className="paste-area"
          autoFocus
          placeholder={'41\t1FP-2-1, 1FP-2-2, 1FP-2-3\t\t\t350\n43\t溶接機\t\t\t225\n47\tスペース'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {text.trim() && (
          <div className="paste-preview">
            <p>
              取り込める回路: <strong>{result.circuits.length}</strong> 件
              {result.skippedHeader && '（見出し行は読み飛ばしました）'}
              {result.errors.length > 0 && <span className="err-count">　取り込めない行: {result.errors.length} 件</span>}
            </p>
            {result.errors.length > 0 && (
              <ul className="error small">
                {result.errors.slice(0, 8).map((e) => (
                  <li key={e.line}>
                    {e.line}行目「{e.text.slice(0, 30)}」: {e.reason}
                  </li>
                ))}
              </ul>
            )}
            {result.circuits.length > 0 && (
              <table className="list small">
                <thead>
                  <tr>
                    <th>No</th>
                    <th>回路名称</th>
                    <th>電気方式</th>
                    <th>電圧</th>
                    <th>AT</th>
                  </tr>
                </thead>
                <tbody>
                  {result.circuits.slice(0, 30).map((c, i) => (
                    <tr key={i}>
                      <td>{c.no}</td>
                      <td>{c.name}</td>
                      <td className={c.defaulted.includes('system') ? 'muted' : ''}>{c.system}</td>
                      <td className={c.defaulted.includes('useVoltage') ? 'muted' : ''}>{c.useVoltage}</td>
                      <td>{c.breakerA ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {result.circuits.length > 30 && <p className="muted small">…ほか {result.circuits.length - 30} 件</p>}
          </div>
        )}
        <div className="toolbar">
          <span className="muted small">薄い文字 = 既定値を使った項目</span>
          <div className="spacer" />
          <button onClick={onClose}>閉じる</button>
          <button className="primary" disabled={result.circuits.length === 0 || !voltOk} onClick={() => onApply(result.circuits)}>
            {result.circuits.length}件を報告書に追加
          </button>
        </div>
      </div>
    </div>
  );
}
