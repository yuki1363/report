import { describe, expect, it } from 'vitest';
import { formatReading, parseReading } from './reading.ts';

describe('測定値の入力解析', () => {
  it.each([
    ['', undefined],
    ['0.12', { kind: 'value', mohm: 0.12 }],
    ['.5', { kind: 'value', mohm: 0.5 }],
    ['０．２', { kind: 'value', mohm: 0.2 }],
    ['>2000', { kind: 'over', mohm: 2000 }],
    ['＞2000', { kind: 'over', mohm: 2000 }],
    ['2000<', { kind: 'over', mohm: 2000 }],
    ['2000以上', { kind: 'over', mohm: 2000 }],
    ['-', { kind: 'na' }],
    ['na', { kind: 'na' }],
    ['abc', null],
    ['1.2.3', null],
  ])('%j', (input, expected) => expect(parseReading(input)).toEqual(expected));

  it('表示との往復', () => {
    for (const s of ['0.12', '>2000', '-']) expect(formatReading(parseReading(s)!)).toBe(s);
  });
});
