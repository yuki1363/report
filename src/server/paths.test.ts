import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { prepareFirstRun, resolvePaths } from './paths.ts';

const tmp = mkdtempSync(join(tmpdir(), 'paths-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('データの置き場所', () => {
  it('ポータブル版（Windows）は %APPDATA%\\InsulationReport。アプリのフォルダの外', () => {
    const p = resolvePaths({ root: 'C:\\Tools\\app-v2', portable: true, env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, platform: 'win32', home: 'C:\\Users\\a' });
    expect(p.home.replace(/\\/g, '/')).toContain('InsulationReport');
    expect(p.home).toContain('Roaming');
    expect(p.dataDir.replace(/\\/g, '/')).toMatch(/InsulationReport\/data$/);
    expect(p.dataDir).not.toContain('app-v2');
  });
  it('どのフォルダに展開しても同じ場所（更新してもデータが残る）', () => {
    const a = resolvePaths({ root: '/x/v1', portable: true, env: {}, platform: 'linux', home: '/home/u' });
    const b = resolvePaths({ root: '/y/v2', portable: true, env: {}, platform: 'linux', home: '/home/u' });
    expect(a).toEqual(b);
    expect(a.dataDir).toBe(join('/home/u', '.insulation-report', 'data'));
  });
  it('開発時はプロジェクト内。INSULATION_REPORT_HOME と DATA_DIR で変更できる', () => {
    expect(resolvePaths({ root: '/proj', portable: false, env: {} }).dataDir).toBe(join('/proj', 'data'));
    expect(resolvePaths({ root: '/proj', portable: true, env: { INSULATION_REPORT_HOME: '/h' } })).toEqual({ home: '/h', dataDir: join('/h', 'data') });
    expect(resolvePaths({ root: '/proj', portable: true, env: { DATA_DIR: '/d' }, platform: 'linux', home: '/home/u' }).dataDir).toBe('/d');
  });
});

describe('初回起動の準備', () => {
  it('旧版の data/ を引き継ぎ、.env を作る。元のデータは消さない。2回目は何もしない', () => {
    const root = join(tmp, 'newapp'); const home = join(tmp, 'home');
    mkdirSync(join(root, 'data', 'imports'), { recursive: true });
    writeFileSync(join(root, 'data', 'app.db'), 'OLD-DB');
    writeFileSync(join(root, 'data', 'imports', 'a.txt'), 'img');
    writeFileSync(join(root, '.env.example'), 'PORT=8787\n');
    const paths = { home, dataDir: join(home, 'data') };
    expect(prepareFirstRun(paths, root)).toEqual({ migratedData: true, createdEnv: true });
    expect(readFileSync(join(home, 'data', 'app.db'), 'utf8')).toBe('OLD-DB');
    expect(existsSync(join(home, 'data', 'imports', 'a.txt'))).toBe(true);
    expect(readFileSync(join(home, '.env'), 'utf8')).toBe('PORT=8787\n');
    expect(existsSync(join(root, 'data', 'app.db'))).toBe(true); // 元は残る
    writeFileSync(join(home, 'data', 'app.db'), 'NEW-DB');
    expect(prepareFirstRun(paths, root)).toEqual({ migratedData: false, createdEnv: false }); // 既にあれば上書きしない
    expect(readFileSync(join(home, 'data', 'app.db'), 'utf8')).toBe('NEW-DB');
  });
  it('アプリのフォルダの .env（旧版で編集済み）があれば、それを写す', () => {
    const root = join(tmp, 'app2'); const home = join(tmp, 'home2');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, '.env'), 'ANTHROPIC_API_KEY=abc\n');
    writeFileSync(join(root, '.env.example'), 'ANTHROPIC_API_KEY=\n');
    prepareFirstRun({ home, dataDir: join(home, 'data') }, root);
    expect(readFileSync(join(home, '.env'), 'utf8')).toBe('ANTHROPIC_API_KEY=abc\n');
  });
});
