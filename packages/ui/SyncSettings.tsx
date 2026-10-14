import { useEffect, useState } from 'react';
import { Cloud, FolderOpen, RefreshCw } from 'lucide-react';
import type { Project, WebDAVConfig } from '../core/model';

export function SyncSettings({
  project,
  onChange,
  onRelocate,
}: {
  project: Project;
  onChange(config: WebDAVConfig): void;
  onRelocate(): Promise<void>;
}) {
  const api = window.texite?.webdav;
  const [config, setConfig] = useState<WebDAVConfig | null>(null);
  const [url, setUrl] = useState(''),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState('');
  const [root, setRoot] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const update = (next: WebDAVConfig) => {
    setConfig(next);
    onChange(next);
  };
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!api) return;
    void action(async () => {
      const next = await api.get();
      update(next);
      setUrl(next.url);
      setUsername(next.username);
      setRoot(await window.texite!.storage!.get());
    });
  }, []);
  if (!api)
    return (
      <p className="settings-note">
        WebDAV 同步和系统目录设置请在 Windows 或 macOS
        桌面版使用。网页版的项目保存在当前浏览器中，可导出 ZIP 迁移。
      </p>
    );
  const binding = config?.projects.find((p) => p.id === project.id);
  const dirty = url !== config?.url || username !== config?.username || !!password;
  return (
    <div className="sync-settings" aria-busy={busy}>
      <section className="sync-connection-card">
        <div className="settings-section-heading">
          <h3>WebDAV</h3>
          <span>手动同步 · 本地副本可离线使用</span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              const next = await api.configure({ url, username, password });
              update(next);
              setUrl(next.url);
              setPassword('');
              setMessage('设置已保存。');
            });
          }}
        >
          <fieldset disabled={busy}>
            <label className="form-field">
              服务地址
              <input
                required
                type="url"
                placeholder="https://dav.example.com/dav/"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <div className="sync-credentials">
              <label className="form-field">
                账号
                <input
                  autoComplete="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <label className="form-field">
                密码 / 应用密码
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder={config?.hasPassword ? '已保存，留空保留' : '服务提供的应用密码'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            </div>
            <div className="sync-actions">
              <button className="primary-button" disabled={!url}>
                保存设置
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={dirty || !config?.url}
                onClick={() =>
                  void action(async () => {
                    const remote = await api.list();
                    setMessage(
                      `连接成功，云端有 ${remote.length} 个项目。可在项目空间点击同步拉取。`,
                    );
                  })
                }
              >
                <RefreshCw size={14} />
                连接并刷新
              </button>
            </div>
          </fieldset>
        </form>
        {config && !config.persistent && (
          <p className="settings-note">系统密钥存储不可用，密码仅保留至本次退出。</p>
        )}
        <details className="sync-details">
          <summary>同步方式与存储说明</summary>
          <p className="settings-note">
            项目存入服务地址下的 Texite 目录，使用 .texite.json
            快照（含源码和图片）。项目空间顶部可拉取云端项目，选中项目可上传；侧栏同步按钮执行双向同步。双方修改冲突时保留独立副本。更换账号或服务地址会清除本机同步关联。
          </p>
        </details>
      </section>
      <section className="sync-current">
        <Cloud size={20} />
        <div>
          <strong>{project.name}</strong>
          <small>
            {binding
              ? '上次同步：' + new Date(binding.time).toLocaleString()
              : '尚未关联 WebDAV · 在项目空间选择项目后上传'}
          </small>
        </div>
        {binding && (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                update(await api.detach(project.id));
                setMessage('已停止关联，本地和云端文件均保留。');
              })
            }
          >
            停止关联
          </button>
        )}
      </section>
      <section className="sync-storage-card">
        <div className="settings-section-heading">
          <h3>项目保存位置</h3>
        </div>
        <div className="storage-path">
          <span title={root}>{root || '正在读取…'}</span>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const next = await window.texite!.storage!.choose();
                if (next) {
                  setRoot(next);
                  setMessage('新建、ZIP 导入和云端下载的项目将保存到此目录。');
                }
              })
            }
          >
            <FolderOpen size={15} />
            更改目录
          </button>
        </div>
        <p className="settings-note">
          用于之后新建、导入和下载的项目；已有项目和关联文件夹保持原位置。
        </p>
        <div className="sync-migration">
          <p className="settings-note">迁移当前项目后，将向新目录保存更改，原目录保留为备份。</p>
          <button
            className="secondary-button"
            disabled={busy || !root}
            onClick={() =>
              void action(async () => {
                await onRelocate();
                setMessage('当前项目已迁移到所选目录，原目录保留为备份。');
              })
            }
          >
            迁移当前项目到此目录
          </button>
        </div>
      </section>
      {message && (
        <p role="status" className="settings-note">
          {message}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
