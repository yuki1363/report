import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT, systemPromptWithNotes } from './claude.ts';

const dir = mkdtempSync(join(tmpdir(), 'notes-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('読み取りの指示文', () => {
  it('MCB の区画・盤が複数・回転した表について書かれている', () => {
    expect(SYSTEM_PROMPT).toContain('MCB');
    expect(SYSTEM_PROMPT).toContain('盤が複数');
    expect(SYSTEM_PROMPT).toContain('回転');
    expect(SYSTEM_PROMPT).toContain('低圧');
    expect(SYSTEM_PROMPT).toContain('高圧');
  });
  it('追加の指示ファイルが無ければそのまま、あれば末尾に足す', () => {
    expect(systemPromptWithNotes(dir)).toBe(SYSTEM_PROMPT);
    writeFileSync(join(dir, 'extract-notes.txt'), '電圧 210 は 200V として扱う\n');
    const p = systemPromptWithNotes(dir);
    expect(p.startsWith(SYSTEM_PROMPT)).toBe(true);
    expect(p).toContain('電圧 210 は 200V として扱う');
  });
});
