import { Crosshair, Download, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import type { Diagnostic, Project, CompileResult } from '../core/model';

const isLayout = (d: Diagnostic) =>
  d.severity !== 'error' && /^(?:Over|Under)full \\[hv]box/.test(d.message);

function diagnosticHelp(d: Diagnostic) {
  if (/^Package epstopdf Warning: Shell escape feature is not enabled\./.test(d.message))
    return '未开放文稿执行系统命令。桌面版 pdfLaTeX / LuaLaTeX 会在编译前自动将项目 EPS 转为 PDF；此提示本身不代表图片缺失。若转换失败，请查看日志中的 EPS → PDF 记录。';
  if (/eps-converted-to\.pdf/.test(d.message))
    return 'EPS 转换结果未找到。请检查原始 EPS 是否已导入项目、文件名大小写与路径是否一致，并查看日志中的 EPS 转换结果；自定义 epstopdf 输出目录暂需手动提供 PDF。';
  if (/^Underfull \\hbox/.test(d.message))
    return '该段落的字间距可能偏大。可定位检查文字、表格列宽或手动换行。';
  if (/^Underfull \\vbox/.test(d.message))
    return '页面或分栏的纵向间距可能偏大。请检查 PDF 中的分页、浮动图片和栏底对齐。';
  if (/^Overfull \\[hv]box/.test(d.message))
    return '内容可能超出行宽或页面边界，请检查 PDF 中是否有溢出或遮挡。';
}

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
  outputs,
  onRecompile,
}: {
  diagnostics: Diagnostic[];
  log: string;
  project: Project;
  compiling?: boolean;
  failed?: boolean;
  onLocate: (file: string, line: number) => void;
  onNotify: (message: string) => void;
  outputs?: CompileResult['outputs'];
  onRecompile?: () => void;
}) {
  const [exporting, setExporting] = useState(false);
  async function exportOutput(file?: string) {
    if (!outputs || !window.texite?.exportCompileOutput) return;
    setExporting(true);
    try {
      if (await window.texite.exportCompileOutput(outputs.buildId, file))
        onNotify(file ? '编译产物已导出。' : '投稿包已导出，包含该次编译的源码与生成文件。');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : '导出失败。');
    } finally {
      setExporting(false);
    }
  }
  const ordered = [...diagnostics].sort(
    (a, b) => Number(a.severity !== 'error') - Number(b.severity !== 'error'),
  );
  const layout = ordered.filter(isLayout);
  const issues = ordered.filter((d) => !isLayout(d));
  const errors = issues.filter((d) => d.severity === 'error').length;
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
  function renderDiagnostic(d: Diagnostic, index: number) {
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
          title={diagnosticHelp(d) ? `${diagnosticHelp(d)}\n点击复制诊断信息` : '点击复制诊断信息'}
          aria-label={`复制诊断：${d.message}`}
          onClick={() => void copy(d)}
        >
          <span className={`diagnostic-meta ${d.severity}`}>
            {d.severity === 'error' ? '错误' : isLayout(d) ? '排版提示' : '警告'}
            {location && <small>{location}</small>}
          </span>
          <span>{d.message}</span>
        </button>
      </div>
    );
  }
  return (
    <section className="diagnostics diagnostics-full" aria-label="编译诊断">
      <div id="compile-diagnostics-body" className="diagnostics-body">
        {(onRecompile || outputs) && (
          <div className="compile-output-actions">
            {onRecompile && (
              <button
                className="secondary-button"
                disabled={compiling || exporting}
                onClick={onRecompile}
              >
                <RotateCcw size={14} />
                清理并重新编译
              </button>
            )}
            {outputs && window.texite?.exportCompileOutput && (
              <button
                className="secondary-button"
                disabled={compiling || exporting}
                onClick={() => void exportOutput()}
                title="导出上次成功编译的源码、参考文献与生成文件"
              >
                <Download size={14} />
                导出投稿包
              </button>
            )}
          </div>
        )}
        {outputs && window.texite?.exportCompileOutput && (
          <details className="compile-output-files">
            <summary>生成文件 · {outputs.files.length}</summary>
            {outputs.files.map((file) => (
              <button
                key={file.path}
                className="compile-output-file"
                disabled={compiling || exporting}
                onClick={() => void exportOutput(file.path)}
              >
                <span>{file.path.replace(/^\.texite-build\//, '')}</span>
                <small>{Math.max(1, Math.round(file.bytes / 1024))} KB</small>
                <Download size={14} />
              </button>
            ))}
          </details>
        )}
        {!!ordered.length && (
          <p className="diagnostics-summary">
            {errors} 个错误 · {issues.length - errors} 个警告 · {layout.length} 条排版提示
          </p>
        )}
        {issues.map(renderDiagnostic)}
        {!!layout.length && (
          <details className="diagnostics-layout">
            <summary>排版提示 · {layout.length}</summary>
            <p className="diagnostic-help">
              这些提示不会阻止生成 PDF，但可能影响字距、分页或内容边界，可展开逐项定位检查。
            </p>
            {layout.map(renderDiagnostic)}
          </details>
        )}
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
