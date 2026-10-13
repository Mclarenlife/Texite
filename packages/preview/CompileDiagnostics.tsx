import { Crosshair } from 'lucide-react';
import type { Diagnostic, Project } from '../core/model';

export function diagnosticTarget(d: Diagnostic, project: Project) {
  if (!d.line || d.line < 1) return undefined;
  const file = d.file
    ? (project.files.find((f) => f.path === d.file) ??
      project.files
        .filter((f) => d.file?.endsWith('/' + f.path))
        .sort((a, b) => b.path.length - a.path.length)[0])
    : project.files.find((f) => f.path === project.mainFile);
  return file && !file.binary ? { file: file.path, line: d.line } : undefined;
}

export function CompileDiagnostics({
  diagnostics,
  log,
  project,
  compiling = false,
  failed = false,
  onLocate,
  onNotify,
}: {
  diagnostics: Diagnostic[];
  log: string;
  project: Project;
  compiling?: boolean;
  failed?: boolean;
  onLocate: (file: string, line: number) => void;
  onNotify: (message: string) => void;
}) {
  const ordered = [...diagnostics].sort(
    (a, b) => Number(a.severity !== 'error') - Number(b.severity !== 'error'),
  );
  async function copy(d: Diagnostic) {
    const location = [d.file, d.line ? `第 ${d.line} 行` : ''].filter(Boolean).join(' · ');
    try {
      const text = [location, d.message].filter(Boolean).join('\n');
      if (window.texite?.writeClipboard) await window.texite.writeClipboard(text);
      else await navigator.clipboard.writeText(text);
      onNotify('诊断信息已复制。');
    } catch {
      onNotify('无法访问剪贴板，请从原始日志中选择并复制。');
    }
  }
  return (
    <section className="diagnostics diagnostics-full" aria-label="编译诊断">
      <div id="compile-diagnostics-body" className="diagnostics-body">
        {ordered.map((d, index) => {
          const target = diagnosticTarget(d, project);
          const location = target ? `${target.file}:${target.line}` : d.file;
          return (
            <div className="diagnostic-row" key={index}>
              <button
                className="icon-button diagnostic-locate"
                disabled={!target}
                title={target ? `定位到 ${location}` : '此诊断没有可定位的项目源码行'}
                aria-label={target ? `定位到 ${location}` : '无源码位置'}
                onClick={() => target && onLocate(target.file, target.line)}
              >
                <Crosshair size={15} />
              </button>
              <button
                className="diagnostic-message"
                title="点击复制诊断信息"
                onClick={() => void copy(d)}
              >
                <span className={`diagnostic-meta ${d.severity}`}>
                  {d.severity === 'error' ? '错误' : '警告'}
                  {location && <small>{location}</small>}
                </span>
                <span>{d.message}</span>
              </button>
            </div>
          );
        })}
        {!ordered.length && (
          <p className="diagnostics-empty">
            {compiling
              ? '正在编译，诊断将随编译进度更新…'
              : failed
                ? '编译未完成，详情见原始日志。'
                : log
                ? '暂无诊断条目，可展开原始日志查看完整编译过程。'
                : '编译后将在这里显示诊断。'}
          </p>
        )}
        <details open={failed && !ordered.length}>
          <summary>原始日志</summary>
          <pre>{log || '尚无编译日志。'}</pre>
        </details>
      </div>
    </section>
  );
}
