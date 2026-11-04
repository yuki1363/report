# 配電盤 絶縁抵抗測定報告書アプリ（CLAUDE.md）

## 1. 目的
1. 配電盤の資料（PDF・画像）から、盤名や回路一覧などを**自動で読み取る**。
2. 読み取った内容で、絶縁抵抗測定報告書を**自動作成**する。
3. できた帳票の書式（レイアウト）を利用者が**自由に編集**し、**Excel または PDF** で保存する。

## 2. 前提・制約
- 利用環境: Windows PC、ローカル起動（社内PC 1台で完結）。
- 測定電圧: 125V / 250V / 500V。
- 読み取り対象（入力資料の想定。実物のサンプルで要検証）
  - 単線結線図・盤図面の PDF（テキスト PDF / スキャン PDF の両方）
  - 盤の銘板や回路名称表示の写真（JPG / PNG）
- 読み取る項目: 盤名、設置場所、回路No、回路名称、電気方式、使用電圧、ブレーカ容量（参考）。
  **測定値は手入力とする**（メガー表示写真の読み取りは P4 で検討）。

## 3. 構成
```
[ブラウザUI (React)] ⇄ [ローカルサーバー (Node + Hono, localhost)] ─→ Claude API（読み取り）
                                    ├─ PDF 出力（Playwright + PC にインストール済みの Edge）
                                    └─ データ保存（SQLite / better-sqlite3、画像はファイル保存）
```
- フロント: Vite + React + TypeScript（strict）
- サーバー: Node 20+ / Hono / TypeScript。`npm start` 1回で起動し、ブラウザを自動で開く。`start.bat` も同梱する。
- API キーは `.env` に置き、**サーバー側だけで使う**（ブラウザには渡さない）。
- 入力値の検証: zod（AI の抽出結果、保存データとも）
- Excel 出力: ExcelJS
- PDF 出力: 帳票を HTML として描画し、Playwright `chromium.launch({ channel: 'msedge' })` の `page.pdf()` で出力する。Chromium の追加ダウンロードは不要。
- テスト: Vitest

## 4. 読み取り処理（抽出パイプライン）
1. **テキスト PDF**: pdfjs-dist で文字と座標を抽出する。Claude には、このテキストと PDF ページの画像を両方渡して構造化させる。
2. **スキャン PDF・画像**: PDF はページを画像化（長辺 2000px 程度）し、Claude の画像入力で読み取る。
3. Claude にはツール定義（JSON スキーマ）で出力形式を強制する。
   - モデル名は `.env` で切り替えられるようにする（既定は Sonnet 系）。
   - 出力する内容:
     ```
     { panel:{name,location}, circuits:[{no,name,system,useVoltage,breakerA}],
       uncertain:[{field, reason}] }
     ```
   - 読めない項目は**推測で埋めず**、null にして `uncertain` に記録するよう指示する。
4. **確認・修正画面（省略不可）**: 左に元資料（拡大・ページ送り可）、右に抽出結果の表を並べて表示する。
   - `uncertain` の項目は黄色で強調する。
   - 利用者が確定するまで、報告書には反映しない。
5. オフライン時の代替手段: Tesseract.js（jpn）で読み取る。
   - 注意: 図面の読み取り精度は低い（不確か）。補助機能という位置づけとし、UI に精度注意の表示を出す。

### 情報管理（要確認事項）
図面や写真は Anthropic API に送信される。**社内の情報持ち出しルールで、外部 API の利用が許可されるか確認すること。**
設定画面で「外部 AI 読み取り ON/OFF」を切り替えられるようにし、OFF のときは Tesseract のみ使う。

## 5. 帳票モデル（グリッド方式）＝自由編集の中核
**設計判断**: 自由編集した書式を Excel と PDF の両方へ同じ見た目で出すため、帳票は「セルのグリッド」でモデル化する（Excel と 1:1 で対応させる）。
座標で自由に配置する方式は Excel に変換できないため、採用しない。

```ts
interface Sheet {
  page: { size: 'A4'|'A3'; orientation: 'portrait'|'landscape';
          marginsMm: {t:number;r:number;b:number;l:number};
          repeatHeaderRows?: [number, number] };     // 改ページ時に繰り返す見出し行
  colWidthsMm: number[]; rowHeightsMm: number[];
  cells: Record<string /* "r,c" */, Cell>;
  merges: { r1:number; c1:number; r2:number; c2:number }[];
  repeatRegion?: { rowStart:number; rowEnd:number; source:'circuits' }; // 回路数ぶん複製する行範囲
  images: { id:string; anchor:{r:number;c:number;r2:number;c2:number} }[];
}
interface Cell {
  value?: string;            // 固定文字、または "{{panel.name}}" "{{c.RE}}" などのバインド
  style?: { font?:string; sizePt?:number; bold?:boolean;
            hAlign?:'left'|'center'|'right'; vAlign?:'top'|'middle'|'bottom';
            wrap?:boolean; shrinkToFit?:boolean; fill?:string;
            border?:{ t?:B; r?:B; b?:B; l?:B } };   // B = 'thin'|'medium'|'thick'|'double'
  numFmt?: string;           // 例 "0.00"
}
```

- **自動作成**: 確定した抽出データと既定テンプレート（`templates/default.json`）から報告書を生成する。repeatRegion を回路数ぶん展開する。
- **書式エディタ**（自作。軽量グリッドUI）
  - セルの文字・書式編集、結合/解除、罫線、列幅/行高のドラッグ変更、行/列の挿入・削除
  - バインド項目の挿入（一覧から選ぶ）、repeatRegion の指定
  - Undo/Redo、Ctrl+C/V
  - 編集した書式は**テンプレートとして名前を付けて保存**し、次回の自動作成で選べるようにする。
  - 「この報告書だけ編集」と「テンプレートとして保存」は区別すること。
- **単位変換**（Excel 出力時）
  - 行高: pt = mm × 72 / 25.4
  - 列幅（文字数単位）: 既定フォントに依存する近似値になる（**不確か**）。換算係数は設定値として持ち、P3 で Excel 実機と比べて校正する。

## 6. 出力
- **Excel**: Sheet モデルから ExcelJS で生成する。用紙設定・余白・印刷範囲・繰り返し見出し行（printTitlesRow）も設定する。数式は使わず、判定結果は値として書き込む。
- **PDF**: 同じ Sheet モデルを HTML テーブル（mm 単位の CSS、`@page`）で描画し、Edge で PDF 化する。改ページ時は見出し行を繰り返す（`thead`）。
- プレビューは PDF と同じ HTML を画面に表示する（見た目のずれを防ぐため）。

## 7. データモデル（測定）
```ts
type WiringSystem = '1φ2W'|'1φ3W'|'3φ3W'|'3φ4W';
type Reading = { kind:'value'; mohm:number } | { kind:'over'; mohm:number } | { kind:'na' };
interface Circuit {
  id:string; no:string; name:string; system:WiringSystem;
  useVoltage:number; groundVoltage:number;   // 対地電圧は系統から自動算出し、手動で上書き可
  testVoltage:125|250|500; breakerA?:number;
  readings: Partial<Record<'RS'|'ST'|'TR'|'RE'|'SE'|'TE'|'NE'|'ALL_E', Reading>>;
  note?:string; source:'ai'|'ocr'|'manual';  // 値の出どころ
}
interface Report {
  id:string; templateId:string; sheetOverride?:Sheet;
  panel:{name:string; location?:string}; date:string; inspector:string;
  tempC?:number; humidity?:number;
  instrument:{model:string; serial?:string; calDate?:string};
  circuits:Circuit[]; sourceFiles:string[];
}
```

## 8. 判定（電気設備技術基準 第58条）
| 区分 | 基準値 |
|---|---|
| 使用電圧 300V 以下、かつ対地電圧 150V 以下 | 0.1 MΩ 以上 |
| 使用電圧 300V 以下で、上記以外 | 0.2 MΩ 以上 |
| 使用電圧 300V 超 | 0.4 MΩ 以上 |

- 判定は、測定値（`value` と `over`）の最小値で行う。`na` は除外する。すべて `na` なら「未判定」とする。
- 盤全体の判定: 1回路でも「否」があれば「否」とする。
- 判定ロジックは `src/domain/` に純粋関数として置き、基準値は設定画面で確認できるようにする。
- 必須テスト:
  - 1φ3W・対地100V・0.12 → 良
  - 3φ3W 200V・0.15 → 否
  - 3φ4W 400V・0.4 → 良（境界値）
  - 全項目 `na` → 未判定
  - `over` 2000 → 良

## 9. 画面
1. 報告書一覧（新規作成、複製、前回値の引き継ぎ）
2. 取込（PDF・画像のドラッグ&ドロップ、複数ファイル可）→ 確認・修正画面
3. 測定値入力（キーボードだけで操作、判定をリアルタイム表示）
4. 書式エディタ ⇄ プレビュー
5. 出力（Excel / PDF）
6. 設定（AI 読み取り ON/OFF、モデル名、判定基準、列幅換算係数、計器マスタ、バックアップ）

## 10. 実装フェーズ
各フェーズ完了時に、テスト結果と動作確認の手順を報告すること。

- **P1**: ローカルサーバーと UI の骨組み、手入力、判定、SQLite 保存、既定テンプレートから PDF 出力（日本語・Ω・φ・髙 を確認）。
- **P2**: 取込と読み取り（テキスト PDF → スキャン/画像）、確認・修正画面。`samples/` の実資料で抽出精度を表にして報告する。
- **P3**: 書式エディタ、テンプレート保存、Excel 出力（列幅換算の校正を含む）。
- **P4**: Tesseract によるオフライン読み取り、前回値との比較、メガー表示写真の読み取り（実験的機能）。

## 11. 開発ルール
- 仕様が曖昧な点は推測で実装せず、確認事項として列挙すること。
- AI の抽出結果は、必ず利用者の確認を経てから使うこと（自動で確定させない）。
- API キーや取り込んだ資料を Git にコミットしないこと（`.env`、`data/`、`samples/` は `.gitignore` に入れる）。
