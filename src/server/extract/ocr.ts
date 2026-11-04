/**
 * オフライン読み取り（Tesseract.js / jpn）。外部 AI 読み取りが OFF のときに使う。
 * 図面の読み取り精度は低い（不確か）ため補助機能の位置づけ。すべての項目を uncertain として返す。
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createWorker, PSM } from 'tesseract.js';
import { circuitField, panelField, type Extraction, type ExtractedCircuit } from '../../shared/extraction.ts';
import type { WiringSystem } from '../../shared/schema.ts';

const require = createRequire(import.meta.url);

/** 日本語の学習データ（npm パッケージ同梱。ネット接続不要） */
function langPath(): string {
  return process.env.TESSDATA_DIR || join(dirname(require.resolve('@tesseract.js-data/jpn/package.json')), '4.0.0_best_int');
}

export async function ocrImages(images: Buffer[]): Promise<string[]> {
  const worker = await createWorker('jpn', 1, { langPath: langPath(), cacheMethod: 'none', gzip: true });
  try {
    // 表の行がそのまま1行になりやすい設定（実測で既定より良好）。日本語の文字間の空白も入れない。
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN, preserve_interword_spaces: '1' });
    const out: string[] = [];
    for (const img of images) out.push((await worker.recognize(img)).data.text);
    return out;
  } finally {
    await worker.terminate();
  }
}

const OCR_REASON = 'オフライン読み取り（OCR）のため精度が低い可能性があります';

/**
 * テキスト PDF のテキスト層（"x,y: 文字列" の行）を、同じ高さの文字をまとめた行にする。
 * OCR より正確なため、オフライン時はテキスト PDF ではこちらを使う。
 */
export function textLayerToLines(text: string, tolerancePx = 8): string {
  const items = text
    .split('\n')
    .map((l) => /^(-?\d+),(-?\d+): (.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]), s: m[3]! }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: { y: number; items: typeof items }[] = [];
  for (const it of items) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= tolerancePx);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  return rows
    .sort((a, b) => a.y - b.y)
    .map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' '))
    .join('\n');
}

const toHalf = (s: string) =>
  s
    .replace(/[０-９Ａ-Ｚａ-ｚ．／（）]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');

/** 電気方式の表記ゆれ（1Φ3W, 1P3W, 単相3線 等）を正規化する */
export function normalizeSystem(s: string): WiringSystem | null {
  const t = toHalf(s).replace(/\s/g, '');
  // φ は OCR で「の」「ゅ」「ゆ」「9」「中」などに誤認されやすい
  const m = /([13])\s*(?:φ|Φ|ϕ|ψ|Ψ|P|p|ph|の|ゅ|ゆ|9|中|ф)\s*([234])\s*W/i.exec(t);
  if (m) {
    const v = `${m[1]}φ${m[2]}W`;
    return (['1φ2W', '1φ3W', '3φ3W', '3φ4W'] as const).find((x) => x === v) ?? null;
  }
  const j = /(単相|三相)([234二三四])線/.exec(t);
  if (j) {
    const n = { '2': '2', '3': '3', '4': '4', 二: '2', 三: '3', 四: '4' }[j[2] as '2'];
    const v = `${j[1] === '単相' ? 1 : 3}φ${n}W`;
    return (['1φ2W', '1φ3W', '3φ3W', '3φ4W'] as const).find((x) => x === v) ?? null;
  }
  return null;
}

/**
 * OCR の文字列から盤名と回路を拾う（簡易な規則）。
 * - 「盤」を含む最初の行 → 盤名
 * - 先頭が番号の行 → 回路（番号・名称・電気方式・電圧・AT を拾う）
 */
export function parseOcrText(texts: string[]): Extraction {
  const lines = texts
    .join('\n')
    .split(/\r?\n/)
    // 表の罫線は「|」「[」などに読まれるので区切りとして扱う
    .map((l) => toHalf(l).replace(/[|｜\[\]]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const panel: Extraction['panels'][number] = { name: null, location: null, circuits: [] };
  const result: Extraction = { panels: [panel], uncertain: [] };

  const panelLine = lines.find((l) => /盤/.test(l) && l.length <= 40 && !/^設置場所/.test(l));
  if (panelLine) {
    panel.name = panelLine
      .replace(/^(盤名|名称)\s*[:：・]?\s*/, '')
      .replace(/\s*(単線結線図|結線図|盤図|姿図|回路図)\s*$/, '')
      .trim();
  }
  result.uncertain.push({ field: panelField(0, 'name'), reason: panelLine ? OCR_REASON : '読み取れませんでした' });
  const locLine = lines.find((l) => /^設置場所/.test(l));
  if (locLine) panel.location = locLine.replace(/^設置場所\s*[:：・]?\s*/, '').trim() || null;
  result.uncertain.push({ field: panelField(0, 'location'), reason: panel.location ? OCR_REASON : '読み取れませんでした' });

  for (const l of lines) {
    const m = /^(?:No\.?\s*)?(\d{1,3}(?:-\d{1,3})?)[\s.:、)]+(.+)$/.exec(l);
    if (!m) continue;
    let rest = m[2]!;
    const system = normalizeSystem(rest);
    const volts = [...rest.matchAll(/(\d{3})\s*\/?\s*(\d{3})?\s*V/gi)].flatMap((x) => [x[1], x[2]]).filter(Boolean).map(Number);
    const at = /(\d{1,4})\s*A(?:T)?\b/i.exec(rest.replace(/(\d+)\s*AF/gi, ''));
    rest = rest
      .replace(/([13])\s*(?:φ|Φ|ϕ|ψ|Ψ|P|ph|の|ゅ|ゆ|9|中|ф)\s*([234])\s*W/gi, '')
      .replace(/(単相|三相)[234二三四]線/g, '')
      .replace(/\d{3}(?:\/\d{3})?\s*V/gi, '')
      .replace(/\d{1,4}\s*A[FT]?\b/gi, '')
      .trim();
    const c: ExtractedCircuit = {
      no: m[1]!,
      name: rest || null,
      system,
      useVoltage: volts.length ? Math.max(...volts) : null,
      breakerA: at ? Number(at[1]) : null,
    };
    const i = panel.circuits.length;
    panel.circuits.push(c);
    for (const k of ['no', 'name', 'system', 'useVoltage', 'breakerA'] as const) {
      result.uncertain.push({ field: circuitField(0, i, k), reason: c[k] === null ? '読み取れませんでした' : OCR_REASON });
    }
  }
  return result;
}
