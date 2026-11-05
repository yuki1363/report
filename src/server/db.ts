/** SQLite 保存（better-sqlite3）。報告書・設定は JSON として保存し、読み書き時に zod で検証する。 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeLegacyVoltage } from '../domain/voltagePattern.ts';
import { ImportRecordSchema, type ImportRecord } from '../shared/extraction.ts';
import {
  DEFAULT_SETTINGS,
  TemplateSchema,
  type Template,
  ReportSchema,
  SettingsSchema,
  type Report,
  type ReportSummary,
  type Settings,
} from '../shared/schema.ts';

export interface ImportFromResult {
  reports: number;
  templates: number;
  /** 既にある方が新しいので取り込まなかった件数 */
  skippedOlder: number;
  /** 形式が不正で取り込めなかった件数 */
  invalid: number;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export class Store {
  readonly db: Database.Database;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS imports (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.migrateVoltagePatterns();
    this.clearCircuitNo();
  }

  /**
   * 以前の版で入力された電圧（100・200・400 など）を、新しい4パターン（105 / 105/210 / 210 / 440）に直す。
   * 一度だけ実行する（電圧は自由に書けるため、以後に書いた電圧は書き換えない）。更新日時は変えない。戻り値は直した報告書の数。
   */
  migrateVoltagePatterns(force = false): number {
    // 電圧は自由に書けるため、直すのは一度だけ（以後に自由に書いた電圧を、再起動で書き換えない）
    const done = this.db.prepare("SELECT value FROM settings WHERE key = 'voltage_patterns_migrated'").get();
    if (done && !force) return 0;
    const rows = this.db.prepare('SELECT id, data FROM reports').all() as { id: string; data: string }[];
    let changed = 0;
    const update = this.db.prepare('UPDATE reports SET data = ? WHERE id = ?');
    this.db.transaction(() => {
      for (const row of rows) {
        const parsed = ReportSchema.safeParse(safeJson(row.data));
        if (!parsed.success) continue;
        const circuits = parsed.data.circuits.map((c) => normalizeLegacyVoltage(c));
        if (circuits.some((c, i) => c !== parsed.data.circuits[i])) {
          update.run(JSON.stringify({ ...parsed.data, circuits }), row.id);
          changed++;
        }
      }
    })();
    this.db.prepare("INSERT INTO settings (key, value) VALUES ('voltage_patterns_migrated', '1') ON CONFLICT(key) DO NOTHING").run();
    return changed;
  }

  /**
   * 回路No は使わなくなったので、保存済みの報告書の回路No をすべて空にする（何度実行しても同じ結果）。
   * 更新日時は変えない。戻り値は直した報告書の数。
   */
  clearCircuitNo(): number {
    const rows = this.db.prepare('SELECT id, data FROM reports').all() as { id: string; data: string }[];
    const update = this.db.prepare('UPDATE reports SET data = ? WHERE id = ?');
    let changed = 0;
    this.db.transaction(() => {
      for (const row of rows) {
        const parsed = ReportSchema.safeParse(safeJson(row.data));
        if (!parsed.success || parsed.data.circuits.every((c) => c.no === '')) continue;
        update.run(JSON.stringify({ ...parsed.data, circuits: parsed.data.circuits.map((c) => ({ ...c, no: '' })) }), row.id);
        changed++;
      }
    })();
    return changed;
  }

  listReports(): ReportSummary[] {
    const rows = this.db.prepare('SELECT data, updated_at FROM reports ORDER BY updated_at DESC').all() as {
      data: string;
      updated_at: string;
    }[];
    return rows.flatMap((row) => {
      const parsed = ReportSchema.safeParse(JSON.parse(row.data));
      if (!parsed.success) return [];
      const r = parsed.data;
      return [
        {
          id: r.id,
          panelName: r.panel.name,
          ...(r.panel.location !== undefined ? { location: r.panel.location } : {}),
          date: r.date,
          inspector: r.inspector,
          circuitCount: r.circuits.length,
          updatedAt: row.updated_at,
        },
      ];
    });
  }

  getReport(id: string): Report | undefined {
    const row = this.db.prepare('SELECT data FROM reports WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? ReportSchema.parse(JSON.parse(row.data)) : undefined;
  }

  saveReport(report: Report): Report {
    const r = ReportSchema.parse(report);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO reports (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(r.id, JSON.stringify(r), now, now);
    return r;
  }

  deleteReport(id: string): boolean {
    return this.db.prepare('DELETE FROM reports WHERE id = ?').run(id).changes > 0;
  }

  /** 全報告書（前回値の比較用） */
  allReports(): Report[] {
    const rows = this.db.prepare('SELECT data FROM reports').all() as { data: string }[];
    return rows.flatMap((row) => {
      const p = ReportSchema.safeParse(JSON.parse(row.data));
      return p.success ? [p.data] : [];
    });
  }

  // --- 取込 ---
  getImport(id: string): ImportRecord | undefined {
    const row = this.db.prepare('SELECT data FROM imports WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? ImportRecordSchema.parse(JSON.parse(row.data)) : undefined;
  }

  saveImport(rec: ImportRecord): ImportRecord {
    const r = ImportRecordSchema.parse(rec);
    this.db
      .prepare('INSERT INTO imports (id, data, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
      .run(r.id, JSON.stringify(r), r.createdAt);
    return r;
  }

  // --- テンプレート（利用者が保存したもの） ---
  listUserTemplates(): Template[] {
    const rows = this.db.prepare('SELECT data FROM templates ORDER BY updated_at DESC').all() as { data: string }[];
    return rows.flatMap((row) => {
      const p = TemplateSchema.safeParse(JSON.parse(row.data));
      return p.success ? [p.data] : [];
    });
  }

  getUserTemplate(id: string): Template | undefined {
    const row = this.db.prepare('SELECT data FROM templates WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? TemplateSchema.parse(JSON.parse(row.data)) : undefined;
  }

  saveUserTemplate(t: Template): Template {
    const v = TemplateSchema.parse(t);
    this.db
      .prepare(
        `INSERT INTO templates (id, name, data, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(v.id, v.name, JSON.stringify(v), new Date().toISOString());
    return v;
  }

  deleteUserTemplate(id: string): boolean {
    return this.db.prepare('DELETE FROM templates WHERE id = ?').run(id).changes > 0;
  }

  getSettings(): Settings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
    if (!row) return structuredClone(DEFAULT_SETTINGS);
    return SettingsSchema.parse({ ...DEFAULT_SETTINGS, ...JSON.parse(row.value) });
  }

  saveSettings(settings: Settings): Settings {
    const s = SettingsSchema.parse(settings);
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(s));
    return s;
  }

  /** 稼働中でも安全に DB をファイルへ複製する */
  async backupTo(file: string): Promise<void> {
    await this.db.backup(file);
  }

  /**
   * 別のデータベース（バックアップの .db、または旧版の data/app.db）から、報告書とテンプレートを取り込む。
   * 既存のデータは消さない。同じ ID は、取り込む側の更新日時が新しい場合だけ置き換える。
   * 形式が不正な項目は取り込まず、件数で返す。
   */
  importFrom(file: string): ImportFromResult {
    let src: Database.Database;
    try {
      src = new Database(file, { readonly: true, fileMustExist: true });
    } catch {
      throw new Error('データベースのファイルとして開けませんでした');
    }
    try {
      let tables: Set<string>;
      try {
        tables = new Set((src.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
      } catch {
        // ファイルの先頭が SQLite でないときは、開くだけでは失敗せず、最初の読み取りで失敗する
        throw new Error('データベースのファイルとして開けませんでした（バックアップの .db か、旧版の data\\app.db を選んでください）');
      }
      if (!tables.has('reports')) throw new Error('報告書のバックアップ（.db）ではありません');
      const result: ImportFromResult = { reports: 0, templates: 0, skippedOlder: 0, invalid: 0 };
      const newer = (table: 'reports' | 'templates', id: string, updated: string): boolean => {
        const cur = this.db.prepare(`SELECT updated_at FROM ${table} WHERE id = ?`).get(id) as { updated_at: string } | undefined;
        return !cur || cur.updated_at < updated;
      };
      const tx = this.db.transaction(() => {
        for (const row of src.prepare('SELECT id, data, created_at, updated_at FROM reports').all() as { id: string; data: string; created_at: string; updated_at: string }[]) {
          const parsed = ReportSchema.safeParse(safeJson(row.data));
          if (!parsed.success) {
            result.invalid++;
          } else if (!newer('reports', parsed.data.id, row.updated_at)) {
            result.skippedOlder++;
          } else {
            const report = parsed.data;
            this.db
              .prepare(
                `INSERT INTO reports (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
              )
              .run(report.id, JSON.stringify(report), row.created_at, row.updated_at);
            result.reports++;
          }
        }
        if (tables.has('templates')) {
          for (const row of src.prepare('SELECT id, name, data, updated_at FROM templates').all() as { id: string; name: string; data: string; updated_at: string }[]) {
            const parsed = TemplateSchema.safeParse(safeJson(row.data));
            if (!parsed.success) {
              result.invalid++;
            } else if (!newer('templates', parsed.data.id, row.updated_at)) {
              result.skippedOlder++;
            } else {
              this.db
                .prepare(
                  `INSERT INTO templates (id, name, data, updated_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at`,
                )
                .run(parsed.data.id, parsed.data.name, JSON.stringify(parsed.data), row.updated_at);
              result.templates++;
            }
          }
        }
      });
      tx();
      this.clearCircuitNo(); // 取り込んだ古いデータの回路No も消す
      return result;
    } finally {
      src.close();
    }
  }

  close(): void {
    this.db.close();
  }
}
