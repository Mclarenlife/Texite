import { useEffect, useState } from 'react';
import { ArrowDownToLine, RefreshCw, ExternalLink } from 'lucide-react';
import type { UpdateInfo } from '../core/model';
export function UpdateSettings({ onPrepare }: { onPrepare(): Promise<void> }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null),
    [state, setState] = useState('idle'),
    [error, setError] = useState(''),
    [progress, setProgress] = useState(0);
  useEffect(() => {
    const api = window.texite?.updates;
    if (!api) return;
    let active = true;
    const refresh = () =>
      void api
        .status()
        .then((s) => {
          if (!active) return;
          setInfo(s.info);
          setProgress(s.progress);
          setError(s.error);
          setState(s.busy ? 'downloading' : s.ready ? 'ready' : 'idle');
        })
        .catch(() => {});
    refresh();
    const off = api.onProgress(refresh);
    return () => {
      active = false;
      off();
    };
  }, []);
  const busy = ['checking', 'downloading', 'opening'].includes(state);
  async function act(action: 'check' | 'download' | 'install') {
    setError('');
    setState(action === 'check' ? 'checking' : action === 'download' ? 'downloading' : 'opening');
    try {
      const api = window.texite?.updates;
      if (!api) throw new Error('请在新版桌面应用中检查更新。');
      if (action === 'check') {
        setInfo(null);
        setInfo(await api.check());
        setState('checked');
      } else if (action === 'download') {
        setProgress(0);
        await api.download();
        setState('ready');
      } else {
        await onPrepare();
        await api.install();
        setState('ready');
      }
    } catch (e) {
      setError((e as Error).message);
      setState(action === 'install' ? 'ready' : 'checked');
    }
  }
  return (
    <section className="update-settings">
      <div>
        <h3>软件更新</h3>
        <p>
          {!window.texite?.updates
            ? '网页版可前往发布页下载桌面应用。'
            : info
              ? info.available
                ? `发现 ${info.version}${info.supported ? '' : '，暂未提供适用于当前系统的安装包'}`
                : `当前已是最新版本或测试版领先于正式版 · 最新正式版 ${info.version}`
              : '从 GitHub Release 检查最新正式版。'}
        </p>
      </div>
      <div className="update-actions">
        {window.texite?.updates && (
          <button className="secondary-button" disabled={busy} onClick={() => void act('check')}>
            <RefreshCw size={14} className={state === 'checking' ? 'spin' : ''} />
            {state === 'checking' ? '检查中…' : '检查更新'}
          </button>
        )}
        {info?.available && info.supported && state !== 'ready' && (
          <button className="primary-button" disabled={busy} onClick={() => void act('download')}>
            <ArrowDownToLine size={14} />
            {state === 'downloading' ? `下载中 ${progress}%` : '下载更新'}
          </button>
        )}
        {state === 'ready' && (
          <button className="primary-button" onClick={() => void act('install')}>
            <ExternalLink size={14} />
            打开安装包
          </button>
        )}
        <a
          href="https://github.com/Mclarenlife/Texite/releases/latest"
          target="_blank"
          rel="noreferrer"
        >
          查看发布页
        </a>
      </div>
      {state === 'downloading' && (
        <progress max={100} value={progress} aria-label="更新包下载进度" />
      )}
      {state === 'ready' && (
        <p className="settings-note">
          安装包已通过 SHA-256 校验。
          {window.texite?.platform === 'darwin'
            ? '打开后将 Texite 拖入应用程序文件夹完成安装。'
            : '打开安装程序后按提示完成更新。'}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
