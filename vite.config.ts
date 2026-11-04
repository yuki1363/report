import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** pdf.js の文字マップ（日本語 PDF の文字抽出に必要）と標準フォントを public/ に配置する */
function pdfjsAssets(): Plugin {
  const copy = () => {
    const dest = fileURLToPath(new URL('./src/client/public/pdfjs/', import.meta.url));
    if (existsSync(dest + 'cmaps')) return;
    const src = fileURLToPath(new URL('./node_modules/pdfjs-dist/', import.meta.url));
    cpSync(src + 'cmaps', dest + 'cmaps', { recursive: true });
    cpSync(src + 'standard_fonts', dest + 'standard_fonts', { recursive: true });
  };
  return { name: 'pdfjs-assets', config: copy };
}

export default defineConfig({
  root: 'src/client',
  // 画面の版（作成スクリプトが付ける。開発時は 'dev'）。画面が古いままでないかの確認に使う
  define: { __APP_BUILD__: JSON.stringify(process.env.BUILD_ID ?? 'dev') },
  plugins: [pdfjsAssets(), react()],
  build: { outDir: '../../dist/client', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  test: { root: '.', include: ['src/**/*.test.ts'] },
} as never);
