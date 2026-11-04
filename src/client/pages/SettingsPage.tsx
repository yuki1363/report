import { useEffect, useState } from 'react';
import type { Settings } from '../../shared/schema.ts';
import { api, type SettingsResponse } from '../api.ts';

export function SettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getSettings()
      .then((d) => {
        setData(d);
        setSettings(d.settings);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data || !settings) return <p>読み込み中…</p>;
  const c = data.criteria;

  const save = async () => {
    setMsg('');
    try {
      setSettings(await api.saveSettings(settings));
      setMsg('保存しました');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="settings">
      <div className="toolbar">
        <h1>設定</h1>
        <button className="primary" onClick={save}>
          保存
        </button>
        {msg && <span className="save save-saved">{msg}</span>}
      </div>

      <fieldset>
        <legend>外部 AI 読み取り</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.aiExtraction}
            onChange={(e) => setSettings({ ...settings, aiExtraction: e.target.checked })}
          />
          外部 AI（Claude API）で資料を読み取る
        </label>
        <p className="warn">
          ON にすると、取り込んだ図面・写真が Anthropic API に送信されます。社内の情報持ち出しルールで外部 API の利用が許可されているか確認してから ON にしてください。
          OFF の場合はオフライン読み取り（OCR）のみ使用します（図面の読み取り精度は低い）。メガー写真の読み取りは ON のときだけ使えます。
        </p>
        <p>
          モデル名: <code>{data.model}</code>（.env の CLAUDE_MODEL で変更）／ API キー: {data.apiKeyConfigured ? '設定済み' : '未設定'}
        </p>
      </fieldset>

      <fieldset>
        <legend>判定基準（電気設備技術基準 第58条）</legend>
        <table className="list">
          <thead>
            <tr>
              <th>区分</th>
              <th>基準値</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                使用電圧 {c.useVoltageLimit}V 以下、かつ対地電圧 {c.groundVoltageLimit}V 以下
              </td>
              <td className="num">{c.lowGroundMohm} MΩ 以上</td>
            </tr>
            <tr>
              <td>使用電圧 {c.useVoltageLimit}V 以下で、上記以外</td>
              <td className="num">{c.lowOtherMohm} MΩ 以上</td>
            </tr>
            <tr>
              <td>使用電圧 {c.useVoltageLimit}V 超</td>
              <td className="num">{c.highMohm} MΩ 以上</td>
            </tr>
          </tbody>
        </table>
        <p className="muted">
          判定は各回路の測定値（数値・上限超過）の最小値で行い、「-」（測定対象外）は除外します。盤全体は1回路でも「否」があれば「否」です。
        </p>
      </fieldset>

      <fieldset>
        <legend>Excel 出力</legend>
        <label>
          列幅換算係数 [mm / 文字]（Excel の列幅 = (列幅mm − 1.32) ÷ 係数。既定 1.85 は理論値のため、下の手順で実機に合わせてください）
          <input
            type="number"
            step="0.01"
            min="0.5"
            value={settings.colWidthMmPerChar}
            onChange={(e) => setSettings({ ...settings, colWidthMmPerChar: Number(e.target.value) || settings.colWidthMmPerChar })}
          />
        </label>
        <details>
          <summary>校正の手順</summary>
          <ol>
            <li>どれかの報告書を「Excel 出力」し、Excel で開いて「ページレイアウト」表示にします。</li>
            <li>ルーラーで、A列〜最終列の合計幅を測ります（既定テンプレートは 277mm になるはずです）。</li>
            <li>新しい係数 = 今の係数 × 測った幅 ÷ 277 を入力して保存し、もう一度出力して確かめます。</li>
          </ol>
          <p className="muted">PC の表示倍率（DPI）や Excel の標準フォントの設定によって変わるため、使う PC で一度合わせてください。</p>
        </details>
      </fieldset>

      <fieldset>
        <legend>バックアップ</legend>
        <p>
          データはアプリフォルダ内の <code>data/</code> に保存されています。アプリを終了してから <code>data/</code> フォルダごとコピーしてください。
          （画面からのバックアップ機能は今後追加予定）
        </p>
      </fieldset>
    </section>
  );
}
