// 書式エディタ単体版（HTML 1ファイル。サーバー・インストール不要）
//   npm run build:format  →  dist/format/書式エディタ.html
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  root: 'src/format',
  base: './',
  plugins: [react(), viteSingleFile()],
  build: { outDir: '../../dist/format', emptyOutDir: true, chunkSizeWarningLimit: 5000 },
});
