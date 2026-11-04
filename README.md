# 配電盤 絶縁抵抗測定報告書アプリ

仕様は [CLAUDE.md](./CLAUDE.md) を参照。現在 **P1（骨組み・手入力・判定・保存・PDF 出力）** まで実装済み。

## セットアップ（Windows）
1. Node.js 20 以上をインストールする。
2. `start.bat` をダブルクリックする（初回は `npm install` を自動実行）。
   - またはコマンドプロンプトで `npm install` → `npm start`
3. ブラウザが自動で開く（http://localhost:8787/）。終了はコンソールで Ctrl+C。

`.env.example` を `.env` にコピーすると、ポート・PDF 用ブラウザ・データ保存先などを変更できる。
PDF 出力には PC にインストール済みの **Microsoft Edge** を使う（Chromium の追加ダウンロードは不要）。

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
