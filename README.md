# 配電盤 絶縁抵抗測定報告書アプリ

仕様は [CLAUDE.md](./CLAUDE.md) を参照。現在 **P1（骨組み・手入力・判定・保存・PDF 出力）** まで実装済み。

## セットアップ（Windows）
1. Node.js 20 以上をインストールする。
2. `start.bat` をダブルクリックする（初回は `npm install` を自動実行）。
   - またはコマンドプロンプトで `npm install` → `npm start`
3. ブラウザが自動で開く（http://localhost:8787/）。終了はコンソールで Ctrl+C。

`.env.example` を `.env` にコピーすると、ポート・PDF 用ブラウザ・データ保存先などを変更できる。
PDF 出力には PC にインストール済みの **Microsoft Edge** を使う（Chromium の追加ダウンロードは不要）。

## ポータブル版（Node.js 同梱・インストール不要）
社内PCに Node.js を入れられない場合や、ネット接続に制限がある場合に使う。

**作成**（インターネットに接続できる PC で1回だけ。Windows / Linux どちらでも可）
```
npm install
npm run package:win
```
→ `release/insulation-report-win-x64.zip`（約 40MB）ができる。
Node.js 本体（v24 LTS）は nodejs.org から取得し、SHA256 を検証して `node.exe` だけを同梱する。
社内プロキシ経由で取得に失敗する場合は、`NODE_USE_ENV_PROXY=1` と `HTTPS_PROXY` を設定して再実行する。

**社内PCでの使い方**: zip を USB・共有フォルダ等でコピー → 展開 → `start.bat`。詳しくは同梱の README.txt。
データは展開先の `data\` に保存される。

## 開発
```
npm run dev         # サーバー(8787) + Vite(5173, ホットリロード)
npm test            # Vitest
npm run typecheck   # tsc（strict）
npm run gen:template  # templates/default.json を再生成
```
実ブラウザでの PDF テストは Windows では自動で実行、他 OS では `PDF_BROWSER=<chrome のパス> npm test` で実行する。

## ディレクトリ
| パス | 内容 |
|---|---|
| `src/shared/schema.ts` | Sheet / Report などの型と zod スキーマ |
| `src/domain/` | 判定・対地電圧算出・テンプレート展開・HTML 描画（純粋関数） |
| `src/server/` | Hono サーバー、SQLite 保存、Edge による PDF 出力 |
| `src/client/` | React 画面 |
| `templates/default.json` | 既定テンプレート（A4 横） |
| `data/` | SQLite・画像（Git 管理外） |
