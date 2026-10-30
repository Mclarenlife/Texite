import { useEffect, useState } from 'react';
import { FolderOpen, Unplug } from 'lucide-react';
export function CompileTools() {
  const api = window.texite?.compileTools;
  const [tools, setTools] = useState({ inkscape: '', latexminted: '' });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    void api
      ?.get()
      .then(setTools)
      .catch((e) => setError(e.message));
  }, [api]);
  async function change(name: 'inkscape' | 'latexminted', remove = false) {
    if (!api) return;
    setBusy(true);
    setError('');
    try {
      setTools(await (remove ? api.remove(name) : api.choose(name)));
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法配置工具。');
    } finally {
      setBusy(false);
    }
  }
  if (!api) return null;
  return (
    <section className="compile-tools" aria-label="外部编译工具">
      <strong>外部工具</strong>
      <p className="runtime-hint">
        按需连接本机程序，配置后可离线使用。TikZ 标准外部化使用当前编译引擎。
      </p>
      {(['inkscape', 'latexminted'] as const).map((name) => (
        <div className="compile-tool-row" key={name}>
          <div>
            <strong>{name === 'inkscape' ? 'SVG · Inkscape' : '代码高亮 · minted 3'}</strong>
            <small title={tools[name]}>{tools[name] || '未配置'}</small>
          </div>
          <button className="secondary-button" disabled={busy} onClick={() => void change(name)}>
            <FolderOpen size={14} />
            {tools[name] ? '更换' : '选择程序'}
          </button>
          {tools[name] && (
            <button
              className="icon-button"
              disabled={busy}
              title="取消关联，不卸载程序"
              aria-label={'取消关联 ' + name}
              onClick={() => void change(name, true)}
            >
              <Unplug size={15} />
            </button>
          )}
        </div>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
