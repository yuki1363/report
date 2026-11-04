/**
 * ブラウザ側での資料の前処理（CLAUDE.md §4-1, §4-2）。
 * - PDF: pdf.js でページを画像化（長辺 2000px 程度）し、テキスト PDF なら文字と座標も取り出す
 * - 画像: 長辺 2000px 以下に縮小
 * サーバー側に画像処理用のネイティブ部品を入れずに済むよう、ブラウザで処理する。
 */
import type { ImportPage } from '../shared/extraction.ts';

export const MAX_SIDE = 2000;
/** Claude の画像1枚あたりの上限（5MB）に余裕を持たせた値 */
const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;
/** 1ページあたりこの文字数以上あればテキスト PDF とみなす */
const TEXT_PDF_MIN_CHARS = 20;

export type PageMeta = Omit<ImportPage, 'index' | 'image' | 'fileName'>;
export interface ProcessedPage {
  meta: PageMeta;
  blob: Blob;
}

export const ACCEPT = 'application/pdf,image/png,image/jpeg';

export function isSupported(f: File): boolean {
  return ['application/pdf', 'image/png', 'image/jpeg'].includes(f.type);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像の変換に失敗しました'))), type, quality),
  );
}

/** PNG で大きすぎる場合は JPEG にする */
async function encode(canvas: HTMLCanvasElement, preferJpeg: boolean): Promise<Blob> {
  if (!preferJpeg) {
    const png = await canvasToBlob(canvas, 'image/png');
    if (png.size <= MAX_IMAGE_BYTES) return png;
  }
  for (const q of [0.92, 0.85, 0.75, 0.6]) {
    const jpg = await canvasToBlob(canvas, 'image/jpeg', q);
    if (jpg.size <= MAX_IMAGE_BYTES) return jpg;
  }
  throw new Error('画像が大きすぎます');
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | undefined;
async function loadPdfjs() {
  pdfjsPromise ??= (async () => {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();
  return pdfjsPromise;
}

export async function processPdf(file: File, fileIndex: number, onPage?: (n: number, total: number) => void): Promise<ProcessedPage[]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
  });
  const doc = await task.promise;
  const out: ProcessedPage[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      onPage?.(n, doc.numPages);
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = MAX_SIDE / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;

      // テキスト層（座標はページ画像のピクセル）
      const tc = await page.getTextContent();
      const lines: string[] = [];
      let chars = 0;
      for (const item of tc.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const t = pdfjs.Util.transform(viewport.transform, item.transform);
        lines.push(`${Math.round(t[4]!)},${Math.round(t[5]!)}: ${item.str.trim()}`);
        chars += item.str.trim().length;
      }
      const isText = chars >= TEXT_PDF_MIN_CHARS;
      out.push({
        meta: {
          fileIndex,
          pageNo: n,
          kind: isText ? 'pdf-text' : 'pdf-scan',
          width: canvas.width,
          height: canvas.height,
          ...(isText ? { text: lines.join('\n') } : {}),
        },
        blob: await encode(canvas, false),
      });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return out;
}

export async function processImage(file: File, fileIndex: number): Promise<ProcessedPage> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return {
    meta: { fileIndex, pageNo: 1, kind: 'image', width: canvas.width, height: canvas.height },
    blob: await encode(canvas, file.type === 'image/jpeg'),
  };
}
