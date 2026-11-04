/**
 * HTML → PDF。PC にインストール済みの Edge を Playwright で起動して page.pdf() する。
 * PDF_BROWSER: "msedge"（既定） / "chrome" / 実行ファイルのフルパス
 */
import { chromium, type Browser, type LaunchOptions } from 'playwright-core';

let browserPromise: Promise<Browser> | undefined;

function launchOptions(): LaunchOptions {
  const spec = process.env.PDF_BROWSER?.trim() || 'msedge';
  if (spec === 'msedge' || spec === 'chrome') return { channel: spec, headless: true };
  return { executablePath: spec, headless: true };
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch(launchOptions()).then((b) => {
      b.on('disconnected', () => (browserPromise = undefined));
      return b;
    });
    browserPromise.catch(() => (browserPromise = undefined));
  }
  return browserPromise;
}

export class PdfBrowserError extends Error {}

export async function htmlToPdf(html: string): Promise<Buffer> {
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (e) {
    throw new PdfBrowserError(
      `PDF 出力用のブラウザを起動できませんでした（PDF_BROWSER=${process.env.PDF_BROWSER ?? 'msedge'}）。` +
        `Microsoft Edge がインストールされているか確認してください。詳細: ${(e as Error).message}`,
    );
  }
  const page = await browser.newPage();
  try {
    await page.emulateMedia({ media: 'print' });
    await page.setContent(html, { waitUntil: 'load' });
    // shrinkToFit スクリプトは load 時に実行済み。フォント読み込み完了も待つ。
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({ preferCSSPageSize: true, printBackground: true });
  } finally {
    await page.close();
  }
}

export async function closePdfBrowser(): Promise<void> {
  const p = browserPromise;
  browserPromise = undefined;
  if (p) await (await p.catch(() => undefined))?.close();
}
