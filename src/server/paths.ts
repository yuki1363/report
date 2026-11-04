/**
 * データとの置き場所の決め方。
 *
 * ポータブル版（Node.js 同梱の zip）では、アプリのフォルダの外にある固定の場所に保存する。
 * 新しい版を別のフォルダに展開しても、データ（報告書・テンプレート・設定・API キーの .env）が残るようにするため。
 *   Windows: %APPDATA%\InsulationReport      その他: ~/.insulation-report
 *   INSULATION_REPORT_HOME で場所を指定できる。DATA_DIR（.env）を指定すればデータの置き場所だけ変えられる。
 * 開発（npm start）では、これまでどおりプロジェクト内（./data と ./.env）を使う。
 */
import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface PathInput {
  /** アプリのフォルダ（dist/ の親） */
  root: string;
  /** ポータブル版か（ビルド時に決まる） */
  portable: boolean;
  env: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  home?: string;
}

export interface AppPaths {
  /** 設定（.env）とデータの置き場所の親 */
  home: string;
  /** データ（app.db・取り込んだ画像）の置き場所 */
  dataDir: string;
}

export function resolvePaths({ root, portable, env, platform = process.platform, home = homedir() }: PathInput): AppPaths {
  let appHome = root;
  if (env.INSULATION_REPORT_HOME?.trim()) {
    appHome = resolve(env.INSULATION_REPORT_HOME.trim());
  } else if (portable) {
    appHome = platform === 'win32' ? join(env.APPDATA?.trim() || join(home, 'AppData', 'Roaming'), 'InsulationReport') : join(home, '.insulation-report');
  }
  const dataDir = env.DATA_DIR?.trim() ? resolve(root, env.DATA_DIR.trim()) : join(appHome, 'data');
  return { home: appHome, dataDir };
}

export interface FirstRunResult {
  /** 旧版の data/（アプリのフォルダ内）から引き継いだか */
  migratedData: boolean;
  /** .env を新しく作ったか */
  createdEnv: boolean;
}

/**
 * 初回起動の準備（ポータブル版のみ）。
 * - 保存先に .env が無ければ、アプリのフォルダの .env（旧版で編集済みのもの）か .env.example を写す
 * - 保存先にデータが無く、アプリのフォルダに旧版の data/ があれば、写して引き継ぐ（元は消さない）
 */
export function prepareFirstRun(paths: AppPaths, root: string): FirstRunResult {
  mkdirSync(paths.home, { recursive: true });
  const result: FirstRunResult = { migratedData: false, createdEnv: false };
  const envFile = join(paths.home, '.env');
  if (!existsSync(envFile)) {
    const src = [join(root, '.env'), join(root, '.env.example')].find((f) => existsSync(f));
    if (src && resolve(src) !== resolve(envFile)) {
      copyFileSync(src, envFile);
      result.createdEnv = true;
    }
  }
  const dbFile = join(paths.dataDir, 'app.db');
  const oldData = join(root, 'data');
  if (!existsSync(dbFile) && existsSync(join(oldData, 'app.db')) && resolve(oldData) !== resolve(paths.dataDir)) {
    mkdirSync(paths.dataDir, { recursive: true });
    cpSync(oldData, paths.dataDir, { recursive: true });
    result.migratedData = true;
  }
  return result;
}
