import { describe, expect, it } from 'vitest';
import type { Sheet } from '../shared/schema.ts';
import {
  applyBorder, applyStyle, clipToTsv, copyRange, deleteCols, deleteRows, expandToMerges, insertCols, insertRows,
  mergeCells, pasteClip, setRepeatHeaderRows, setRepeatRegion, setValue, sheetWarnings, tsvToClip, unmergeCells,
} from './sheetOps.ts';

const base = (): Sheet => ({
  page: { size: 'A4', orientation: 'portrait', marginsMm: { t: 10, r: 10, b: 10, l: 10 }, repeatHeaderRows: [1, 1] },
  colWidthsMm: [10, 20, 30],
  rowHeightsMm: [5, 6, 7, 8],
  cells: { '0,0': { value: 'A' }, '2,1': { value: '{{c.name}}', style: { bold: true } }, '3,2': { value: 'Z' } },
  merges: [{ r1: 0, c1: 0, r2: 0, c2: 1 }],
  repeatRegion: { rowStart: 2, rowEnd: 2, source: 'circuits' },
  images: [],
});

describe('行・列の挿入/削除', () => {
  it('行の挿入でセル・結合・繰り返し行・見出し行がずれる', () => {
    const s = insertRows(base(), 1, 2);
    expect(s.rowHeightsMm).toEqual([5, 5, 5, 6, 7, 8]);
    expect(s.cells['4,1']!.value).toBe('{{c.name}}');
    expect(s.cells['5,2']!.value).toBe('Z');
    expect(s.repeatRegion).toMatchObject({ rowStart: 4, rowEnd: 4 });
    expect(s.page.repeatHeaderRows).toEqual([3, 3]);
    expect(s.merges).toEqual([{ r1: 0, c1: 0, r2: 0, c2: 1 }]);
  });
  it('繰り返し行を削除すると指定が消える', () => {
    const s = deleteRows(base(), 2);
    expect(s.repeatRegion).toBeUndefined();
    expect(s.cells['2,2']!.value).toBe('Z');
    expect(s.rowHeightsMm).toEqual([5, 6, 8]);
  });
  it('列の挿入・削除で結合が伸縮する', () => {
    expect(insertCols(base(), 1).merges).toEqual([{ r1: 0, c1: 0, r2: 0, c2: 2 }]);
    const d = deleteCols(base(), 1);
    expect(d.merges).toEqual([]); // 1セルになった結合は消える
    expect(d.colWidthsMm).toEqual([10, 30]);
    expect(d.cells['3,1']!.value).toBe('Z');
  });
  it('最後の1行・1列は削除できない', () => {
    const one: Sheet = { ...base(), rowHeightsMm: [5], colWidthsMm: [5], cells: {}, merges: [], repeatRegion: undefined, page: { ...base().page, repeatHeaderRows: undefined } };
    expect(deleteRows(one, 0)).toBe(one);
    expect(deleteCols(one, 0)).toBe(one);
  });
});

describe('結合', () => {
  it('結合すると左上以外の値は消え、重なる結合は置き換わる', () => {
    const s = mergeCells(setValue(base(), 1, 1, 'x'), { r1: 0, c1: 1, r2: 1, c2: 2 });
    expect(s.merges).toEqual([{ r1: 0, c1: 1, r2: 1, c2: 2 }]);
    expect(s.cells['1,1']?.value).toBeUndefined();
    expect(unmergeCells(s, { r1: 1, c1: 2, r2: 1, c2: 2 }).merges).toEqual([]);
  });
  it('選択範囲を結合セル全体に広げる', () => {
    expect(expandToMerges(base(), { r1: 0, c1: 1, r2: 0, c2: 1 })).toEqual({ r1: 0, c1: 0, r2: 0, c2: 1 });
  });
});

describe('書式・罫線', () => {
  it('書式の部分適用と削除', () => {
    let s = applyStyle(base(), { r1: 2, c1: 1, r2: 2, c2: 2 }, { hAlign: 'center' });
    expect(s.cells['2,1']!.style).toEqual({ bold: true, hAlign: 'center' });
    s = applyStyle(s, { r1: 2, c1: 1, r2: 2, c2: 1 }, { bold: undefined });
    expect(s.cells['2,1']!.style).toEqual({ hAlign: 'center' });
  });
  it('外枠罫線と、結合の左上への反映', () => {
    const s = applyBorder(base(), { r1: 0, c1: 0, r2: 1, c2: 1 }, 'outer', 'medium');
    expect(s.cells['0,0']!.style!.border).toEqual({ t: 'medium', l: 'medium', r: 'medium' }); // 結合(0,0)-(0,1)の右端
    expect(s.cells['1,1']!.style!.border).toEqual({ r: 'medium', b: 'medium' });
    const n = applyBorder(s, { r1: 0, c1: 0, r2: 1, c2: 1 }, 'none', 'thin');
    expect(n.cells['1,1']!.style!.border).toEqual({});
  });
});

describe('コピー・貼り付け', () => {
  it('書式付きで貼り付け', () => {
    const clip = copyRange(base(), { r1: 0, c1: 0, r2: 0, c2: 1 });
    const s = pasteClip(base(), { r: 3, c: 0 }, clip, true);
    expect(s.cells['3,0']!.value).toBe('A');
    expect(s.merges).toContainEqual({ r1: 3, c1: 0, r2: 3, c2: 1 });
  });
  it('TSV の往復と、値だけの貼り付け（はみ出しは切り捨て）', () => {
    const clip = tsvToClip('1\t2\t3\t4\nx\r\n');
    expect(clip.rows).toBe(2);
    expect(clipToTsv(clip)).toBe('1\t2\t3\t4\nx\t\t\t');
    const s = pasteClip(base(), { r: 2, c: 1 }, clip, false);
    expect(s.cells['2,1']).toEqual({ value: '1', style: { bold: true } });
    expect(s.cells['2,2']!.value).toBe('2');
    expect(s.cells['2,3']).toBeUndefined();
  });
});

describe('繰り返し行・見出し行の指定', () => {
  it('境界をまたぐ結合があると指定できない', () => {
    const s = mergeCells(base(), { r1: 1, c1: 0, r2: 2, c2: 0 });
    expect(typeof setRepeatRegion(s, 2, 2)).toBe('string');
    expect(typeof setRepeatHeaderRows(base(), 2, 2)).toBe('string'); // 回路行と重なる
    expect(setRepeatHeaderRows(base(), 1, 1)).toMatchObject({ page: { repeatHeaderRows: [1, 1] } });
  });
  it('警告: 回路の項目が繰り返し行の外', () => {
    const s = setValue(base(), 3, 0, '{{c.no}}');
    expect(sheetWarnings(s).join()).toContain('繰り返し行の外');
  });
});
