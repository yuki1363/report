import { renameSync } from 'node:fs';
renameSync('dist/format/index.html', 'dist/format/書式エディタ.html');
console.log('出力: dist/format/書式エディタ.html');
