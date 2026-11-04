import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TemplateSchema } from '../shared/schema.ts';
import { blankForm } from './blankForm.ts';

const tpl = TemplateSchema.parse(JSON.parse(readFileSync(new URL('../../templates/default.json', import.meta.url), 'utf8'))).sheet;

describe('空欄の書式', () => {
  it('回路行を指定行数ぶん複製し、差し込み項目を空にする', () => {
    const s = blankForm(tpl, 20);
    expect(s.rowHeightsMm.length).toBe(tpl.rowHeightsMm.length + 19);
    expect(s.repeatRegion).toBeUndefined();
    expect(s.cells['8,0']!.style?.border).toBeDefined();
    expect(s.cells['27,16']!.style?.border).toBeDefined(); // 20行目の最終列
    expect(s.cells['2,0']!.value).toBe('盤名：');
    expect(JSON.stringify(s.cells)).not.toContain('{{');
    expect(s.page.repeatHeaderRows).toEqual([6, 7]);
    // 備考欄は回路行の後ろにずれる
    expect(s.cells['29,0']!.value).toBe('備考');
    expect(JSON.stringify(s.cells)).not.toContain('総合判定');
  });
  it('1行でも動き、元のテンプレートは変更しない', () => {
    const before = JSON.stringify(tpl);
    expect(blankForm(tpl, 1).rowHeightsMm.length).toBe(tpl.rowHeightsMm.length);
    expect(JSON.stringify(tpl)).toBe(before);
  });
});
