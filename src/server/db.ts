/** SQLite 保存（better-sqlite3）。報告書・設定は JSON として保存し、読み書き時に zod で検証する。 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  DEFAULT_SETTINGS,
  ReportSchema,
  SettingsSchema,
  type Report,
  type ReportSummary,
  type Settings,
} from '../shared/schema.ts';

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
    `);
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

  close(): void {
    this.db.close();
  }
}
