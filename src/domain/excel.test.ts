import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateSheet } from './generate.ts';
import { TemplateSchema } from '../shared/schema.ts';
import { sampleReport } from '../server/testFixtures.ts';
import { colName, mmToExcelWidth, mmToPt, sheetToXlsx } from './excel.ts';

const template = TemplateSchema.parse(JSON.parse(readFileSync(new URL('../../templates/default.json', import.meta.url), 'utf8')));

describe('Excel 出力', () => {
  it('単位変換', () => {
    expect(mmToPt(25.4)).toBe(72);
    expect(colName(0)).toBe('A');
    expect(colName(25)).toBe('Z');
    expect(colName(26)).toBe('AA');
    expect(mmToExcelWidth(14.28, 1.85)).toBeCloseTo(7, 0);
  });

  it('用紙・印刷範囲・見出し行・結合・値・罫線', async () => {
    const sheet = generateSheet(template.sheet, sampleReport(30));
    const buf = await sheetToXlsx(sheet, { colWidthMmPerChar: 1.85, title: '動力盤 P-1' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.pageSetup.orientation).toBe('portrait');
    expect(ws.pageSetup.paperSize).toBe(9);
    expect(ws.pageSetup.printTitlesRow).toBe('7:8');
    expect(ws.pageSetup.printArea).toBe(`A1:N${sheet.rowHeightsMm.length}`);
    expect(ws.pageSetup.margins!.left).toBeCloseTo(8 / 25.4, 5); // 左右の余白は 8mm
    expect(ws.pageSetup.margins!.top).toBeCloseTo(10 / 25.4, 5);
    expect(ws.getCell('A1').value).toBe('絶縁抵抗測定報告書');
    expect(ws.getCell('A1').isMerged).toBe(true);
    expect(ws.getRow(9).height).toBeCloseTo(mmToPt(7), 1);
    // 回路行: 数値は数値として、上限超過は文字として書く
    expect(ws.getCell('G9').value).toBe(100); // R-E
    expect(ws.getCell('K9').value).toBe('>2000');
    expect(ws.getCell('M9').value).toBe('良');
    expect(ws.getCell('A9').value).toBe('空調機 AC-1（髙効率）');
    // 結合セル（見出し「回路名称」A7:A8）の外周罫線
    expect(ws.getCell('A8').border.bottom?.style).toBe('thin');
    expect(ws.getCell('A7').border.top?.style).toBe('thin');
    // 判定セルは数式ではなく値
    expect(typeof ws.getCell('M13').value).toBe('string');
    expect(ws.getCell('M13').value).toBe('良'); // 5回路目: 1φ3W 対地100V・0.15MΩ → 基準0.1 → 良
  });
});

import { safeSheetName, sheetsToXlsx, uniqueSheetNames } from './excel.ts';

describe('Excel の複数シート（一括出力）', () => {
  it('シート名: 使えない文字は _、31文字まで、空は既定名', () => {
    expect(safeSheetName('低圧/動力盤:No.1?[a]*')).toBe('低圧_動力盤_No.1__a__');
    expect(safeSheetName('あ'.repeat(40))).toHaveLength(31);
    expect(safeSheetName('   ', '報告書3')).toBe('報告書3');
  });
  it('同じ盤名でもシート名が重ならない（大文字小文字も区別しない）', () => {
    expect(uniqueSheetNames(['盤A', '盤A', 'abc', 'ABC', '', '盤A'])).toEqual(['盤A', '盤A (2)', 'abc', 'ABC (2)', '報告書5', '盤A (3)']);
    const long = 'あ'.repeat(31);
    const names = uniqueSheetNames([long, long]);
    expect(names[1]).toHaveLength(31);
    expect(new Set(names).size).toBe(2);
  });
  it('報告書ごとに1シート。順番・書式（用紙の向きなど）はシートごと', async () => {
    const a = generateSheet(template.sheet, sampleReport(3));
    const b = generateSheet({ ...template.sheet, page: { ...template.sheet.page, orientation: 'landscape' } }, sampleReport(1));
    const buf = await sheetsToXlsx([{ sheet: a, title: '盤1' }, { sheet: b, title: '盤1' }], { colWidthMmPerChar: 1.85 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['盤1', '盤1 (2)']);
    expect(wb.worksheets[0]!.pageSetup.orientation).toBe('portrait');
    expect(wb.worksheets[1]!.pageSetup.orientation).toBe('landscape');
    expect(wb.worksheets[0]!.getCell('A1').value).toBe('絶縁抵抗測定報告書');
    expect(wb.worksheets[0]!.getCell('A11').value).toBeTruthy(); // 回路が3行ぶん入っている（回路名称は A 列）
  });
});
