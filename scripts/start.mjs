// npm start: クライアントをビルド（未ビルドまたはソース更新時）してからサーバーを起動する。
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const built = join(root, 'dist/client/index.html');

function newestMtime(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return t;
}

const srcNewest = Math.max(newestMtime(join(root, 'src/client')), newestMtime(join(root, 'src/shared')), newestMtime(join(root, 'src/domain')));
if (!existsSync(built) || statSync(built).mtimeMs < srcNewest) {
  console.log('画面をビルドしています...');
  const r = spawnSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const r = spawnSync('npx', ['tsx', 'src/server/main.ts', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 0);
