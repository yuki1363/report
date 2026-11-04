/**
 * 実ブラウザでの PDF 出力テスト。PDF_BROWSER（msedge / chrome / 実行ファイルパス）で起動できない環境ではスキップする。
 * 例: PDF_BROWSER=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome npx vitest run src/server/pdf.test.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { generateSheet } from '../domain/generate.ts';
import { renderSheetHtml } from '../domain/renderHtml.ts';
import { TemplateSchema } from '../shared/schema.ts';
import { sampleReport } from './testFixtures.ts';
import { closePdfBrowser, htmlToPdf } from './pdf.ts';

const enabled = Boolean(process.env.PDF_BROWSER) || process.platform === 'win32';
const template = TemplateSchema.parse(JSON.parse(readFileSync(new URL('../../templates/default.json', import.meta.url), 'utf8')));

describe.skipIf(!enabled)('PDF 出力（実ブラウザ）', () => {
  afterAll(() => closePdfBrowser());

  it('日本語・Ω・φ・髙 を含む報告書を複数ページで出力できる', async () => {
    const html = renderSheetHtml(generateSheet(template.sheet, sampleReport(40)));
    const pdf = await htmlToPdf(html);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    mkdirSync('data/test-output', { recursive: true });
    writeFileSync('data/test-output/sample.pdf', pdf);
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(2);
  }, 60_000);
});
