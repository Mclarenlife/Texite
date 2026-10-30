import { useEffect, useState } from 'react';
import { Download, Package, Trash2, Cpu, RotateCcw, Check, LoaderCircle } from 'lucide-react';
import type { RuntimeModule } from '../core/model';
import { CompileTools } from './CompileTools';
const size = (bytes: number) =>
  bytes >= 1e6 ? (bytes / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1000)) + ' KB';
export function RuntimeSettings({ onChange }: { onChange: () => void }) {
  const [modules, setModules] = useState<RuntimeModule[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'engine' | 'package'>('engine');
  const [removing, setRemoving] = useState<RuntimeModule | null>(null);
  const [pack, setPack] =
    useState<Awaited<ReturnType<NonNullable<Window['texite']>['chooseRuntimePack']>>>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [autoDownload, setAutoDownload] = useState(true);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void action(async () => setModules(await window.texite!.listRuntime()));
    void window.texite
      ?.getPackageDownloadSettings?.()
      .then((s) => setAutoDownload(s.autoDownload))
      .catch((e) => setError(e.message));
  }, []);
  function selectedWithDependencies(ids: string[]) {
    const next = new Set(ids);
    function add(id: string) {
      const m = pack?.modules.find((m) => m.id === id);
      for (const d of m?.dependencies || [])
        if (!next.has(d) && !modules.some((m) => m.id === d)) {
          next.add(d);
          add(d);
        }
    }
    ids.forEach(add);
    return [...next];
  }
  const visible = modules.filter(
    (m) => m.kind === tab && (m.label + ' ' + m.id).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="runtime-settings" aria-label="引擎与宏包管理">
      <div className="runtime-heading">
        <div>
          <strong>引擎与宏包</strong>
          <p>
            已安装 {modules.filter((m) => m.kind === 'engine').length} 个引擎 ·{' '}
            {size(modules.reduce((sum, m) => sum + m.bytes, 0))}
          </p>
        </div>
        <Package size={21} />
      </div>
      <div className="runtime-actions">
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              const p = await window.texite!.chooseRuntimePack();
              setPack(p);
              setSelected(p?.modules.map((m) => m.id) || []);
            })
          }
        >
          <Download size={14} />
          导入离线扩展包
        </button>
        <button
          className="icon-button"
          aria-label="恢复默认 pdfLaTeX 与宏包"
          title="恢复默认环境"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              setModules(await window.texite!.restoreDefaultRuntime());
              onChange();
            })
          }
        >
          <RotateCcw size={15} />
        </button>
      </div>
      {window.texite?.setPackageDownloadSettings && (
        <label className="setting-row">
          <span>
            自动补齐缺失宏包
            <small>
              从 TeX Live 镜像下载匹配的 2025 版宏包及依赖。只在缺包时联网，安装后可离线使用。
            </small>
          </span>
          <input
            type="checkbox"
            aria-label="自动补齐缺失宏包"
            checked={autoDownload}
            disabled={busy}
            onChange={(e) => {
              const value = e.target.checked;
              void action(async () => {
                const settings = await window.texite!.setPackageDownloadSettings!({
                  autoDownload: value,
                });
                setAutoDownload(settings.autoDownload);
              });
            }}
          />
        </label>
      )}
      <p className="runtime-hint">
        安装包仅带 pdfLaTeX。其他引擎从{' '}
        <a
          href="https://github.com/Mclarenlife/Texite/releases/latest"
          target="_blank"
          rel="noreferrer"
        >
          GitHub Release
        </a>{' '}
        下载后导入；已安装的引擎与宏包可离线使用。
      </p>
      {pack ? (
        <div className="runtime-import">
          <strong>{pack.label}</strong>
          <p>{pack.platform} · 选择要保留的模块，所需依赖会一并安装。</p>
          <div className="runtime-module-list">
            {pack.modules.map((m) => (
              <label key={m.id} className="runtime-import-row">
                <input
                  type="checkbox"
                  checked={selected.includes(m.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? selectedWithDependencies([...selected, m.id])
                        : selected.filter((id) => id !== m.id),
                    )
                  }
                />
                <span>
                  {m.label}
                  <small>{m.version}</small>
                </span>
                <small>{size(m.bytes)}</small>
              </label>
            ))}
          </div>
          <div className="runtime-actions">
            <button
              className="secondary-button"
              disabled={busy || !selected.length}
              onClick={() =>
                void action(async () => {
                  setModules(await window.texite!.installRuntimePack(selected));
                  setPack(null);
                  onChange();
                })
              }
            >
              <Check size={14} />
              安装所选模块及依赖
            </button>
            <button className="text-button" disabled={busy} onClick={() => setPack(null)}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="runtime-tabs">
            <button
              aria-pressed={tab === 'engine'}
              onClick={() => {
                setTab('engine');
                setQuery('');
              }}
            >
              <Cpu size={14} />
              编译引擎
            </button>
            <button aria-pressed={tab === 'package'} onClick={() => setTab('package')}>
              <Package size={14} />
              宏包与字体
            </button>
          </div>
          {tab === 'package' && (
            <input
              className="runtime-search"
              aria-label="搜索已安装宏包"
              placeholder="搜索宏包或字体…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <div className="runtime-module-list">
            {visible.map((m) => (
              <div className="runtime-module" key={m.id}>
                <span>
                  <strong>{m.label}</strong>
                  <small>
                    {m.version} · {size(m.bytes)}
                  </small>
                  {m.requiredBy?.length ? (
                    <small title={m.requiredBy.join('、')}>{m.requiredBy.length} 个模块依赖</small>
                  ) : null}
                </span>
                <button
                  className="icon-button"
                  aria-label={'卸载 ' + m.label}
                  title={
                    m.requiredBy?.length
                      ? '请先卸载依赖此模块的项目：' + m.requiredBy.join('、')
                      : '卸载'
                  }
                  disabled={busy || !!m.requiredBy?.length}
                  onClick={() => setRemoving(m)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!visible.length && !busy && <p className="runtime-hint">没有匹配的已安装模块。</p>}
          </div>
        </>
      )}
      {removing && (
        <div className="runtime-confirm" role="alert">
          <p>
            卸载 {removing.label}，释放 {size(removing.bytes)}
            ？文稿会保留，使用它的文稿将需要重新导入该模块才能编译。
          </p>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                setModules(await window.texite!.removeRuntimeModule(removing.id));
                setRemoving(null);
                onChange();
              })
            }
          >
            确认卸载
          </button>
          <button className="text-button" disabled={busy} onClick={() => setRemoving(null)}>
            取消
          </button>
        </div>
      )}
      {busy && (
        <p className="runtime-hint" role="status">
          <LoaderCircle size={14} className="spin" />
          正在处理本地编译资源…
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <CompileTools />
    </section>
  );
}
