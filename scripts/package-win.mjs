// Node.js 同梱版（ポータブル版）を作成する。
//   npm run package:win
//
// 出力: release/insulation-report-win-x64/ と release/insulation-report-win-x64.zip
// 社内PCでは、フォルダをコピーして start.bat を実行するだけで起動する（インストール・ネット接続不要）。
//
// 作成には、インターネットに接続できる PC が1回だけ必要（Node.js 本体の取得のため）。
// Linux / Windows のどちらでも実行できる。
//
// オプション（動作確認用）:
//   --target=linux-x64   Linux 用を作成する（この環境での起動テスト用）
//   --no-zip             zip を作らない
import AdmZip from 'adm-zip';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 同梱する Node.js（LTS）。better-sqlite3 は engines: node>=22 */
const NODE_VERSION = 'v24.22.2';

const args = process.argv.slice(2);
const target = (args.find((a) => a.startsWith('--target=')) ?? '--target=win-x64').split('=')[1];
const makeZip = !args.includes('--no-zip');
if (!['win-x64', 'linux-x64'].includes(target)) throw new Error(`未対応の target: ${target}`);
const isWin = target === 'win-x64';

const root = fileURLToPath(new URL('..', import.meta.url));
const name = `insulation-report-${target}`;
const out = join(root, 'release', name);
const cacheDir = join(root, '.cache');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// 画面とサーバーに同じ「版」を埋め込む（古い画面が残っていないかの確認に使う）
const gitShort = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim();
const BUILD_ID = `${new Date().toISOString().slice(0, 16).replace('T', ' ')}${gitShort ? ` ${gitShort}` : ''}`;
const log = (m) => console.log(`[package] ${m}`);
const run = (cmd, argv, cwd = root, env = process.env) => {
  const r = spawnSync(cmd, argv, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} が失敗しました`);
};

// 1. 出力先を作り直す
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 2. 画面をビルド
log('画面をビルド');
run('npx', ['vite', 'build'], root, { ...process.env, BUILD_ID });
cpSync(join(root, 'dist/client'), join(out, 'dist/client'), { recursive: true });

// 3. サーバーを1ファイルにまとめる（ネイティブ部品・ワーカーを使う部品は外出し）
// exceljs は本体に組み込む（部品が数千ファイルあり、Windows での展開が極端に遅くなるため）
const runtimeDeps = ['better-sqlite3', 'playwright-core', 'tesseract.js', '@tesseract.js-data/jpn'];
log('サーバーをバンドル');
await build({
  entryPoints: [join(root, 'src/server/main.ts')],
  outfile: join(out, 'dist/server/main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: runtimeDeps,
  // CommonJS 依存（dotenv など）の require を ESM で動かすための shim
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  // ポータブル版: データは新しい版に更新しても残る固定の場所（%APPDATA%\InsulationReport）に保存する
  define: { 'process.env.APP_PORTABLE': '"1"', 'process.env.APP_BUILD': JSON.stringify(BUILD_ID) },
  legalComments: 'none',
  logLevel: 'warning',
});

// 4. テンプレート・設定ファイル
cpSync(join(root, 'templates'), join(out, 'templates'), { recursive: true });
cpSync(join(root, '.env.example'), join(out, '.env.example'));

// 5. 実行時に必要な部品だけをインストール
log('実行用の部品をインストール');
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const exact = (dep) => lock.packages[`node_modules/${dep}`].version;
writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      private: true,
      type: 'module',
      dependencies: Object.fromEntries(runtimeDeps.map((d) => [d, exact(d)])),
    },
    null,
    2,
  ),
);
run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--os=' + (isWin ? 'win32' : 'linux'), '--cpu=x64'], out);
rmSync(join(out, 'package-lock.json'), { force: true });

// better-sqlite3: 対象 OS 以外のバイナリとビルド用ソースを削除（容量削減）
const bs3 = join(out, 'node_modules/better-sqlite3');
const keep = isWin ? 'win32-x64.node' : 'linux-x64.node';
if (!existsSync(join(bs3, 'prebuilds', keep))) throw new Error(`better-sqlite3 に ${keep} がありません`);
for (const f of ['linux-arm64', 'linux-x64', 'linuxmusl-x64', 'linuxmusl-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64', 'win32-arm64']) {
  if (`${f}.node` !== keep) rmSync(join(bs3, 'prebuilds', `${f}.node`), { force: true });
}
rmSync(join(bs3, 'deps'), { recursive: true, force: true });
rmSync(join(bs3, 'src'), { recursive: true, force: true });
// OCR 用の日本語データは軽量版（best_int, 2MB）だけ残す
rmSync(join(out, 'node_modules/@tesseract.js-data/jpn/4.0.0'), { recursive: true, force: true });

// 6. Node.js 本体（公式配布物。SHA256 を検証）
const nodeDir = join(out, 'node');
mkdirSync(nodeDir, { recursive: true });
if (isWin) {
  const file = `node-${NODE_VERSION}-win-x64.zip`;
  const buf = await fetchCached(file);
  const zip = new AdmZip(buf);
  const prefix = `node-${NODE_VERSION}-win-x64/`;
  for (const f of ['node.exe', 'LICENSE']) {
    const e = zip.getEntry(prefix + f);
    if (!e) throw new Error(`${file} に ${f} がありません`);
    writeFileSync(join(nodeDir, f), e.getData());
  }
} else {
  // Linux 用（動作確認用）: この環境の node をそのまま使う
  cpSync(process.execPath, join(nodeDir, 'node'));
  chmodSync(join(nodeDir, 'node'), 0o755);
}

// 7. 起動ファイルと説明書
if (isWin) {
  writeFileSync(join(out, 'start.bat'), crlf(readFileSync(join(root, 'scripts/portable/start.bat'), 'utf8')));
  writeFileSync(join(out, 'README.txt'), crlf(readFileSync(join(root, 'scripts/portable/README.txt'), 'utf8')));
} else {
  writeFileSync(join(out, 'start.sh'), '#!/bin/sh\ncd "$(dirname "$0")"\n[ -f .env ] || cp .env.example .env\nexec ./node/node dist/server/main.mjs "$@"\n');
  chmodSync(join(out, 'start.sh'), 0o755);
}
writeFileSync(join(out, 'VERSION.txt'), `${pkg.name} ${pkg.version}\n版 ${BUILD_ID}\nNode.js ${isWin ? NODE_VERSION : process.version}\n作成日時 ${new Date().toISOString()}\n`);

// 8. zip
if (makeZip) {
  log('zip を作成');
  const zip = new AdmZip();
  zip.addLocalFolder(out, name);
  zip.writeZip(join(root, 'release', `${name}.zip`));
}
log(`完了: ${out}${makeZip ? ` / release/${name}.zip` : ''}`);

// ---------------------------------------------------------------------------

async function fetchCached(file) {
  mkdirSync(cacheDir, { recursive: true });
  const local = join(cacheDir, file);
  const base = `https://nodejs.org/dist/${NODE_VERSION}/`;
  const sums = await (await fetchOk(base + 'SHASUMS256.txt')).text();
  const expected = sums.split('\n').find((l) => l.trim().endsWith(' ' + file))?.split(/\s+/)[0];
  if (!expected) throw new Error(`SHASUMS256.txt に ${file} がありません`);
  let buf = existsSync(local) ? readFileSync(local) : undefined;
  if (!buf || sha256(buf) !== expected) {
    log(`Node.js を取得: ${base}${file}`);
    buf = Buffer.from(await (await fetchOk(base + file)).arrayBuffer());
  }
  if (sha256(buf) !== expected) throw new Error(`${file} のチェックサムが一致しません`);
  writeFileSync(local, buf);
  log(`Node.js ${NODE_VERSION} SHA256 検証 OK`);
  return buf;
}

async function fetchOk(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} の取得に失敗しました (${res.status})`);
  return res;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function crlf(s) {
  return s.replace(/\r?\n/g, '\r\n');
}
