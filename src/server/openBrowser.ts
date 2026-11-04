import { spawn } from 'node:child_process';

/** 既定のブラウザで URL を開く（失敗しても起動は継続）。 */
export function openBrowser(url: string): void {
  try {
    const [cmd, args] =
      process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : process.platform === 'darwin'
          ? ['open', [url]]
          : ['xdg-open', [url]];
    const child = spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore' });
    child.on('error', () => console.log(`ブラウザで ${url} を開いてください`));
    child.unref();
  } catch {
    console.log(`ブラウザで ${url} を開いてください`);
  }
}
