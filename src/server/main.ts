/** ローカルサーバー起動。npm start / start.bat から呼ばれる。 */
import { config as loadEnv } from 'dotenv';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { Store } from './db.ts';
import { openBrowser } from './openBrowser.ts';
import { prepareFirstRun, resolvePaths } from './paths.ts';
import { closePdfBrowser } from './pdf.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CLIENT_DIR = join(ROOT, 'dist/client');

// ポータブル版かどうかは、作成スクリプトがビルド時に決める（開発時は未定義）
const PORTABLE = process.env.APP_PORTABLE === '1';
// データの置き場所は .env の DATA_DIR より前に決める必要があるため、先に保存先の .env を読む
const first = resolvePaths({ root: ROOT, portable: PORTABLE, env: process.env });
loadEnv({ path: join(first.home, '.env'), quiet: true });
loadEnv({ path: join(ROOT, '.env'), quiet: true }); // 保存先に無い設定は、アプリのフォルダの .env から（先に読んだ方が優先）
const paths = resolvePaths({ root: ROOT, portable: PORTABLE, env: process.env });
if (PORTABLE) {
  const r = prepareFirstRun(paths, ROOT);
  if (r.createdEnv) console.log(`設定ファイルを作成しました: ${join(paths.home, '.env')}`);
  if (r.migratedData) console.log(`以前のデータを引き継ぎました: ${paths.dataDir}`);
  // 初回に作った .env を読み込む
  loadEnv({ path: join(paths.home, '.env'), quiet: true });
}
const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = paths.dataDir;
console.log(`データの保存先: ${DATA_DIR}`);

const store = new Store(join(DATA_DIR, 'app.db'));
const app = createApp({ store, dataDir: DATA_DIR, paths: { home: paths.home, dataDir: DATA_DIR, portable: PORTABLE } });

if (existsSync(CLIENT_DIR)) {
  // serveStatic の root はカレントディレクトリ基準の相対パス
  const root = relative(process.cwd(), CLIENT_DIR) || '.';
  app.use('/*', serveStatic({ root }));
  const indexHtml = readFileSync(join(CLIENT_DIR, 'index.html'), 'utf8');
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'not found' }, 404) : c.html(indexHtml)));
}

const server = serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, (info) => {
  const url = `http://localhost:${info.port}/`;
  console.log(`絶縁抵抗測定報告書アプリ: ${url}  （終了は Ctrl+C）`);
  if (!process.argv.includes('--no-open')) openBrowser(url);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    const url = `http://localhost:${PORT}/`;
    console.error(`ポート ${PORT} は使用中です。アプリが既に起動している可能性があります: ${url}`);
    console.error('別のソフトが使っている場合は、.env の PORT を変更してください。');
    if (!process.argv.includes('--no-open')) openBrowser(url);
    store.close();
    process.exit(2);
  }
  throw err;
});

const shutdown = async () => {
  await closePdfBrowser();
  server.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
