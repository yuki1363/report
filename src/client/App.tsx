import { useEffect, useState } from 'react';
import { ReportEditor } from './pages/ReportEditor.tsx';
import { ReportList } from './pages/ReportList.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

/** ハッシュルーティング: #/ 一覧, #/reports/:id 編集, #/settings 設定 */
function useHash(): string {
  const [hash, setHash] = useState(() => location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(location.hash || '#/');
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const reportMatch = /^#\/reports\/([\w-]+)/.exec(hash);
  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          絶縁抵抗測定報告書
        </a>
        <nav>
          <a href="#/" className={hash === '#/' ? 'active' : ''}>
            報告書一覧
          </a>
          <a href="#/settings" className={hash === '#/settings' ? 'active' : ''}>
            設定
          </a>
        </nav>
      </header>
      <main>
        {reportMatch ? (
          <ReportEditor key={reportMatch[1]} id={reportMatch[1]!} />
        ) : hash === '#/settings' ? (
          <SettingsPage />
        ) : (
          <ReportList />
        )}
      </main>
    </div>
  );
}
