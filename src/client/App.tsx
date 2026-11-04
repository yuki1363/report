import { useEffect, useState } from 'react';
import { ConfirmPage } from './pages/ConfirmPage.tsx';
import { ImportPage } from './pages/ImportPage.tsx';
import { ReportEditor } from './pages/ReportEditor.tsx';
import { ReportList } from './pages/ReportList.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { TemplatesPage } from './pages/TemplatesPage.tsx';

/**
 * ハッシュルーティング:
 *  #/ 一覧 / #/reports/:id 編集 / #/import[/:reportId] 取込 / #/imports/:id 確認・修正
 *  #/templates[/:id] テンプレート / #/settings 設定
 */
function useHash(): string {
  const [hash, setHash] = useState(() => location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(location.hash || '#/');
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

function route(hash: string) {
  const [path = '', query = ''] = hash.slice(1).split('?');
  const q = new URLSearchParams(query);
  let m: RegExpExecArray | null;
  if ((m = /^\/reports\/([\w-]+)$/.exec(path))) return <ReportEditor key={m[1]} id={m[1]!} />;
  if ((m = /^\/import(?:\/([\w-]+))?$/.exec(path))) return <ImportPage key={m[1] ?? 'new'} {...(m[1] ? { targetReportId: m[1] } : {})} />;
  if ((m = /^\/imports\/([\w-]+)$/.exec(path))) return <ConfirmPage key={m[1]} id={m[1]!} auto={q.get('auto') === '1'} />;
  if ((m = /^\/templates(?:\/([\w-]+))?$/.exec(path))) return <TemplatesPage key={m[1] ?? 'list'} {...(m[1] ? { editId: m[1] } : {})} />;
  if (path === '/settings') return <SettingsPage />;
  return <ReportList />;
}

/** 画面（ブラウザ）の版とサーバーの版が違うと、古い画面が残っている */
function useBuildCheck(): { server: string | null; stale: boolean } {
  const [server, setServer] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/health', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { build?: string }) => setServer(j.build ?? null))
      .catch(() => {});
  }, []);
  return { server, stale: server !== null && server !== __APP_BUILD__ };
}

export function App() {
  const hash = useHash();
  const build = useBuildCheck();
  const top = hash.split('?')[0]!;
  const nav = (href: string, label: string, match: (h: string) => boolean) => (
    <a href={href} className={match(top) ? 'active' : ''}>
      {label}
    </a>
  );
  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          絶縁抵抗測定報告書
        </a>
        <nav>
          {nav('#/', '報告書一覧', (h) => h === '#/' || h.startsWith('#/reports') || h.startsWith('#/import'))}
          {nav('#/templates', '書式テンプレート', (h) => h.startsWith('#/templates'))}
          {nav('#/settings', '設定', (h) => h === '#/settings')}
        </nav>
        <span className="build" title="アプリの版（更新後に表示が変わらないときの確認用）">版 {__APP_BUILD__}</span>
      </header>
      {build.stale && (
        <p className="warn stale">
          画面が古い版のままです（画面 {__APP_BUILD__} ／ アプリ {build.server}）。<strong>Ctrl キーを押しながら F5</strong> を押して、読み込み直してください。
        </p>
      )}
      <main>{route(hash)}</main>
    </div>
  );
}
