/** ローカルサーバー起動。npm start / start.bat から呼ばれる。 */
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { Store } from './db.ts';
import { openBrowser } from './openBrowser.ts';
import { closePdfBrowser } from './pdf.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CLIENT_DIR = join(ROOT, 'dist/client');
const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = resolve(ROOT, process.env.DATA_DIR || './data');

const store = new Store(join(DATA_DIR, 'app.db'));
const app = createApp({ store });

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
