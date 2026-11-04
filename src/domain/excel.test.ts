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
    expect(ws.pageSetup.orientation).toBe('landscape');
    expect(ws.pageSetup.paperSize).toBe(9);
    expect(ws.pageSetup.printTitlesRow).toBe('7:8');
    expect(ws.pageSetup.printArea).toBe(`A1:P${sheet.rowHeightsMm.length}`);
    expect(ws.pageSetup.margins!.left).toBeCloseTo(10 / 25.4, 5);
    expect(ws.getCell('A1').value).toBe('絶縁抵抗測定報告書');
    expect(ws.getCell('A1').isMerged).toBe(true);
    expect(ws.getRow(9).height).toBeCloseTo(mmToPt(7), 1);
    // 回路行: 数値は数値として、上限超過は文字として書く
    expect(ws.getCell('H9').value).toBe(100); // R-E
    expect(ws.getCell('L9').value).toBe('>2000');
    expect(ws.getCell('O9').value).toBe('良');
    expect(ws.getCell('B9').value).toBe('空調機 AC-1（髙効率）');
    // 結合セル（見出し「No」A7:A8）の外周罫線
    expect(ws.getCell('A8').border.bottom?.style).toBe('thin');
    expect(ws.getCell('A7').border.top?.style).toBe('thin');
    // 判定セルは数式ではなく値
    expect(typeof ws.getCell('O13').value).toBe('string');
    expect(ws.getCell('O13').value).toBe('良'); // 5回路目: 1φ3W 対地100V・0.15MΩ → 基準0.1 → 良
  });
});
