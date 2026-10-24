import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Code2,
  Download,
  FilePlus2,
  FileText,
  Files,
  FolderPlus,
  LoaderCircle,
  Play,
  Plus,
  Search,
  Settings2,
  Square,
  Undo2,
  Redo2,
  Upload,
  X,
} from 'lucide-react';
import { createProject } from '../../packages/core/sample';
import {
  getReferences,
  isTextFile,
  parseDiagnostics,
  safePath,
  type Project,
} from '../../packages/core/model';
import { importZip } from '../../packages/platform/storage';
import { SourceEditor, type EditorHandle } from '../../packages/editor/SourceEditor';
import { PdfViewer } from '../../packages/preview/PdfViewer';
import { AssetPreview } from '../../packages/preview/AssetPreview';
import { CompileDiagnostics } from '../../packages/preview/CompileDiagnostics';
import { Dialog } from '../../packages/ui/Dialog';
import { usePreference } from '../../packages/ui/preferences';
import { compileOffline, type MobileCompileResult } from './compiler';
import { useMobileViewport } from './useMobileViewport';
import {
  chooseIOSProject,
  isIOS,
  mobilePlatformName,
  exportMobileFile,
  backgroundAndroid,
  exportMobileProject,
  onAndroidBack,
  readMobileProjects,
  saveMobileProject,
} from './native';

type Sheet = 'files' | 'new' | 'file' | 'folder' | 'settings' | null;
const chinese = String.raw`\documentclass[12pt]{article}
\usepackage[margin=24mm]{geometry}
\usepackage{CJKutf8}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{hyperref}
\begin{document}
\begin{CJK*}{UTF8}{gbsn}
\section{从这里开始}
这是 Texite 移动版的离线中文文稿。
\begin{equation}
  E = mc^2
\end{equation}
\end{CJK*}
\end{document}
`;
const message = (error: unknown) => (error instanceof Error ? error.message : '操作失败，请重试');

export function MobileApp() {
  useMobileViewport();
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const current = useRef(project);
  current.current = project;
  const [booted, setBooted] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('chinese');
  const [tab, setTab] = useState<'editor' | 'pdf'>('editor');
  const [result, setResult] = useState<MobileCompileResult | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const [notice, setNotice] = useState('');
  const [saveState, setSaveState] = useState('已保存');
  const [compileStatus, setCompileStatus] = useState('');
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const [fontSize, setFontSize] = usePreference<number>('mobile-editor-font-size', 15);
  const [theme, setTheme] = usePreference<string>('mobile-theme', 'system');
  const [query, setQuery] = useState('');
  const editor = useRef<EditorHandle>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const assetInput = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [opening, setOpening] = useState(false);
  const pendingSave = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    readMobileProjects()
      .then(setProjects)
      .catch((e) => setNotice(message(e)))
      .finally(() => setBooted(true));
  }, []);
  useEffect(() => {
    const report = (event: Event) => setNotice((event as CustomEvent<string>).detail);
    window.addEventListener('mobile-error', report);
    return () => window.removeEventListener('mobile-error', report);
  }, []);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    const listener = onAndroidBack(() => {
      if (sheet) setSheet(null);
      else if (current.current && !busy) setProject(null);
      else if (busy) setNotice('编译进行中，可点击顶部停止按钮');
      else void backgroundAndroid();
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [sheet, busy]);
  useEffect(() => () => abort.current?.abort(), []);
  function persist(next: Project) {
    setSaveState('保存中…');
    const pending = saveMobileProject(next);
    pendingSave.current = pending;
    void pending
      .then(() => {
        setProjects((items) => [next, ...items.filter((p) => p.id !== next.id)]);
        if (current.current?.id === next.id && current.current.revision === next.revision)
          setSaveState('已保存');
      })
      .catch((error) => {
        setSaveState('保存失败');
        setNotice(message(error));
      });
  }
  function change(next: Project) {
    current.current = next;
    setProject(next);
    persist(next);
  }
  function update(content: string, path: string) {
    const p = current.current;
    if (!p) return;
    change({
      ...p,
      revision: p.revision + 1,
      updatedAt: Date.now(),
      files: p.files.map((f) => (f.path === path ? { ...f, content } : f)),
    });
  }
  async function open(p: Project) {
    if (busy || opening) return;
    setOpening(true);
    try {
      await pendingSave.current;
      current.current = p;
      setProject(p);
      setResult(null);
      setTab('editor');
      setSheet(null);
      setNotice('');
    } catch (e) {
      setNotice(message(e));
    } finally {
      setOpening(false);
    }
  }
  async function importProject(file: File) {
    try {
      const next = await importZip(file);
      await saveMobileProject(next);
      setProjects((items) => [next, ...items]);
      await open(next);
    } catch (error) {
      setNotice(message(error));
    }
  }
  async function chooseProject() {
    if (!isIOS) {
      importInput.current?.click();
      return;
    }
    try {
      const file = await chooseIOSProject();
      if (file) await importProject(file);
    } catch (error) {
      setNotice(message(error));
    }
  }
  async function compile() {
    if (busy || !current.current) return;
    const p = structuredClone(current.current);
    setBusy(true);
    setCompileStatus('准备离线编译器');
    setNotice('');
    const controller = new AbortController();
    abort.current = controller;
    try {
      await pendingSave.current;
      const output = await compileOffline(p, controller.signal, setCompileStatus);
      setResult(output);
      setDiagnosticsOpen(!output.success);
      setTab('pdf');
      if (output.success && output.pdf) {
        const bytes = output.pdf;
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const path = p.mainFile.replace(/\.tex$/i, '.pdf');
        const latest = current.current!;
        change({
          ...latest,
          files: [
            ...latest.files.filter((f) => f.path !== path),
            { path, binary: true, content: btoa(binary) },
          ],
        });
      }
    } catch (e) {
      setNotice(message(e));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }
  async function create() {
    try {
      if (!name.trim()) throw new Error('请输入名称');
      if (sheet === 'new') {
        const p = createProject(name.trim(), template === 'blank');
        if (template === 'chinese') {
          p.files = [{ path: 'main.tex', content: chinese }];
        }
        await saveMobileProject(p);
        setProjects((items) => [p, ...items]);
        await open(p);
      } else if (project) {
        const path = safePath(name.trim());
        if (project.files.some((f) => f.path === path) || project.folders?.includes(path))
          throw new Error('此名称已存在');
        if (sheet === 'folder')
          change({
            ...project,
            folders: [...(project.folders || []), path],
            revision: project.revision + 1,
          });
        else {
          if (!isTextFile(path)) throw new Error('请输入 .tex、.bib 等文本文件名；图片请使用导入');
          change({
            ...project,
            files: [...project.files, { path, content: '' }],
            activeFile: path,
            revision: project.revision + 1,
          });
          setTab('editor');
        }
      }
      setSheet(null);
    } catch (e) {
      setNotice(message(e));
    }
  }
  const file = project?.files.find((f) => f.path === project.activeFile) ?? project?.files[0];
  const diagnostics = parseDiagnostics(result?.log || '');
  const generatedPdf = project?.files.find(
    (f) => f.path === project.mainFile.replace(/\.tex$/i, '.pdf') && f.binary,
  );
  // Decode only when switching to preview; the compiler result remains stable during typing.
  const pdf = useMemo(
    () =>
      result?.pdf ??
      (generatedPdf ? Uint8Array.from(atob(generatedPdf.content), (c) => c.charCodeAt(0)) : null),
    [result?.pdf, generatedPdf?.content],
  );
  function newSheet(value: Sheet) {
    setName('');
    setNotice('');
    setSheet(value);
  }
  return (
    <div className={'mobile-app' + (project ? ' has-project' : '')}>
      <header className="mobile-header">
        <button
          className="mobile-brand"
          aria-label="项目空间"
          disabled={busy}
          onClick={() => setProject(null)}
        >
          {project ? <ArrowLeft size={21} /> : <span className="mobile-mark">T</span>}
        </button>
        <div className="mobile-heading">
          <strong>{project?.name || 'Texite'}</strong>
          <small>{project ? saveState : '项目空间'}</small>
        </div>
        {project && (
          <button
            className="mobile-compile"
            onClick={() => (busy ? abort.current?.abort() : void compile())}
          >
            {busy ? <Square size={16} /> : <Play size={16} />}
            <span>{busy ? '停止' : '编译'}</span>
          </button>
        )}
        <button className="mobile-icon" aria-label="设置" onClick={() => setSheet('settings')}>
          <Settings2 size={20} />
        </button>
      </header>
      {notice && (
        <div className="mobile-notice" role="alert">
          <span>{notice}</span>
          <button aria-label="关闭提示" onClick={() => setNotice('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {!project ? (
        <main className="mobile-library">
          <div className="mobile-library-heading">
            <div>
              <h1>我的文稿</h1>
              <p>{projects.length} 个项目 · 保存在此设备</p>
            </div>
            <button className="mobile-primary" onClick={() => newSheet('new')}>
              <Plus size={18} />
              新建
            </button>
          </div>
          <label className="mobile-search">
            <Search size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索项目"
              aria-label="搜索项目"
            />
          </label>
          <button className="mobile-import" onClick={() => void chooseProject()}>
            <Upload size={19} />
            <span>导入 ZIP 项目</span>
            <ChevronRight size={17} />
          </button>
          {!booted ? (
            <p role="status">正在读取项目…</p>
          ) : !projects.length ? (
            <div className="mobile-empty">
              <FileText size={36} />
              <h2>开始一份新文稿</h2>
              <p>创建中文或英文项目，也可以导入电脑上的 ZIP。</p>
            </div>
          ) : (
            <div className="mobile-project-grid">
              {projects
                .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
                .map((p) => (
                  <button className="mobile-project-card" key={p.id} onClick={() => void open(p)}>
                    <div className="mobile-paper">
                      <FileText size={28} />
                      <span>
                        {p.files.find((f) => f.path === p.mainFile)?.content.slice(0, 200)}
                      </span>
                    </div>
                    <strong>{p.name}</strong>
                    <small>
                      {p.files.length} 个文件 · {new Date(p.updatedAt).toLocaleDateString()}
                    </small>
                  </button>
                ))}
            </div>
          )}
          <p className="mobile-offline-label">
            <Check size={14} />
            内置 pdfLaTeX · 无需联网编译
          </p>
        </main>
      ) : (
        <>
          <div className="mobile-document-bar">
            <button className="mobile-file-button" onClick={() => setSheet('files')}>
              <Files size={17} />
              <span>{file?.path || '选择文件'}</span>
            </button>
            <button
              className="mobile-icon"
              aria-label="撤回"
              disabled={!history.undo || !!file?.binary}
              onClick={() => editor.current?.undo()}
            >
              <Undo2 size={17} />
            </button>
            <button
              className="mobile-icon"
              aria-label="取消撤回"
              disabled={!history.redo || !!file?.binary}
              onClick={() => editor.current?.redo()}
            >
              <Redo2 size={17} />
            </button>
            <button
              className="mobile-icon"
              aria-label="搜索文稿"
              onClick={() => {
                setTab('editor');
                setTimeout(() => editor.current?.search(), 0);
              }}
            >
              <Search size={17} />
            </button>
          </div>
          <main className={'mobile-workspace mobile-tab-' + tab}>
            <section className="mobile-editor-pane" aria-label="文稿编辑器">
              {file &&
                (file.binary ? (
                  <AssetPreview file={file} />
                ) : (
                  <SourceEditor
                    nativeSelection
                    ref={editor}
                    projectId={project.id}
                    file={file}
                    fontSize={fontSize}
                    references={getReferences(project.files).map((r) => r.key)}
                    files={project.files.map((f) => f.path)}
                    onChange={update}
                    onCursor={(line, column) => setPosition({ line, column })}
                    onCompile={() => void compile()}
                    onSave={() => persist(current.current!)}
                    onHistoryState={(undo, redo) => setHistory({ undo, redo })}
                  />
                ))}
            </section>
            <section className="mobile-preview-pane">
              <PdfViewer
                bytes={pdf}
                stale={!!result && result.revision !== project.revision}
                diagnosticCount={diagnostics.length}
                diagnosticsOpen={diagnosticsOpen}
                onDiagnosticsChange={setDiagnosticsOpen}
                diagnosticSeverity={
                  diagnostics.some((d) => d.severity === 'error') ? 'error' : 'warning'
                }
                diagnostics={
                  <CompileDiagnostics
                    project={project}
                    diagnostics={diagnostics}
                    log={result?.log || ''}
                    compiling={busy}
                    failed={!!result && !result.success}
                    onNotify={setNotice}
                    onLocate={(path, line) => {
                      change({ ...project, activeFile: path });
                      setTab('editor');
                      setTimeout(() => {
                        const source = project.files.find((f) => f.path === path)?.content || '';
                        editor.current?.jump(
                          source
                            .split('\n')
                            .slice(0, line - 1)
                            .join('\n').length + (line > 1 ? 1 : 0),
                        );
                      }, 0);
                    }}
                  />
                }
              />
            </section>
          </main>
          {busy && (
            <div className="mobile-compile-status" role="status">
              <LoaderCircle size={14} className="spin" />
              {compileStatus}
            </div>
          )}
          <nav className="mobile-bottom-nav" aria-label="工作区">
            <button onClick={() => setSheet('files')}>
              <Files size={20} />
              <span>文件</span>
            </button>
            <button aria-pressed={tab === 'editor'} onClick={() => setTab('editor')}>
              <Code2 size={20} />
              <span>编辑</span>
            </button>
            <button aria-pressed={tab === 'pdf'} onClick={() => setTab('pdf')}>
              <BookOpen size={20} />
              <span>预览</span>
            </button>
            <button
              onClick={() => void exportMobileProject(project).catch((e) => setNotice(message(e)))}
            >
              <Download size={20} />
              <span>导出</span>
            </button>
          </nav>
          <div className="mobile-cursor-status">
            第 {position.line} 行 · 第 {position.column} 列 <span>pdfLaTeX · TeX Live 2023</span>
          </div>
        </>
      )}
      <input
        hidden
        ref={importInput}
        type="file"
        accept=".zip,application/zip"
        onChange={async (e) => {
          const input = e.target;
          const f = input.files?.[0];
          input.value = '';
          if (!f) return;
          await importProject(f);
        }}
      />
      <input
        hidden
        ref={assetInput}
        type="file"
        multiple
        onChange={async (e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          try {
            const p = current.current;
            if (!p) return;
            const imported = [];
            for (const f of files) {
              if (f.size > 20 * 1024 * 1024) throw new Error('单文件不能超过 20 MB');
              const path = safePath(f.name);
              if (p.files.some((item) => item.path === path))
                throw new Error(path + ' 已存在，请先重命名');
              if (isTextFile(path)) imported.push({ path, content: await f.text() });
              else {
                const bytes = new Uint8Array(await f.arrayBuffer());
                let text = '';
                for (let i = 0; i < bytes.length; i += 8192)
                  text += String.fromCharCode(...bytes.subarray(i, i + 8192));
                imported.push({ path, content: btoa(text), binary: true });
              }
            }
            change({ ...p, files: [...p.files, ...imported], revision: p.revision + 1 });
          } catch (error) {
            setNotice(message(error));
          }
        }}
      />
      <Dialog
        open={sheet === 'files'}
        onClose={() => setSheet(null)}
        title="项目文件"
        className="mobile-sheet"
      >
        <div className="mobile-file-actions">
          <button onClick={() => newSheet('file')}>
            <FilePlus2 size={17} />
            新建文件
          </button>
          <button onClick={() => newSheet('folder')}>
            <FolderPlus size={17} />
            文件夹
          </button>
          <button onClick={() => assetInput.current?.click()}>
            <Upload size={17} />
            导入
          </button>
        </div>
        <div className="mobile-files">
          {project?.folders?.map((folder) => (
            <div className="mobile-folder" key={folder}>
              <Files size={17} />
              {folder}/
            </div>
          ))}
          {project?.files.map((f) => (
            <button
              key={f.path}
              aria-current={f.path === file?.path ? 'true' : undefined}
              onClick={() => {
                change({ ...project, activeFile: f.path });
                setSheet(null);
                setTab('editor');
              }}
            >
              <FileText size={17} />
              <span>{f.path}</span>
              {f.path === project.mainFile && <small>主文件</small>}
            </button>
          ))}
        </div>
        <p className="mobile-hint">
          新建文件可填写“文件夹/文件名.tex”。长按编辑区可使用系统文字选择。
        </p>
      </Dialog>
      <Dialog
        open={sheet === 'new' || sheet === 'file' || sheet === 'folder'}
        onClose={() => setSheet(null)}
        title={sheet === 'new' ? '新建项目' : sheet === 'folder' ? '新建文件夹' : '新建文件'}
        className="mobile-sheet"
      >
        <form
          className="mobile-form"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label>
            名称
            <input
              autoFocus
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              placeholder={sheet === 'file' ? '章节/intro.tex' : '输入名称'}
            />
          </label>
          {sheet === 'new' && (
            <fieldset>
              <legend>文稿模板</legend>
              <div className="mobile-choice-row">
                {[
                  ['chinese', '中文文稿'],
                  ['sample', '英文论文'],
                  ['blank', '空白文稿'],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={template === value}
                    onClick={() => setTemplate(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <button className="mobile-primary" type="submit">
            创建
          </button>
        </form>
      </Dialog>
      <Dialog
        open={sheet === 'settings'}
        onClose={() => setSheet(null)}
        title="设置"
        className="mobile-sheet"
      >
        <div className="mobile-settings">
          <h3>外观</h3>
          <div className="mobile-choice-row">
            {[
              ['light', '浅色'],
              ['dark', '深色'],
              ['system', '跟随系统'],
            ].map(([value, label]) => (
              <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}>
                {label}
              </button>
            ))}
          </div>
          <label>
            编辑字号 <strong>{fontSize}px</strong>
            <input
              aria-label="编辑字号"
              type="range"
              min={12}
              max={24}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
            />
          </label>
          {project && (
            <>
              <h3>主文稿</h3>
              <div className="mobile-main-files">
                {project.files
                  .filter((f) => f.path.endsWith('.tex'))
                  .map((f) => (
                    <button
                      key={f.path}
                      aria-pressed={project.mainFile === f.path}
                      onClick={() =>
                        change({
                          ...project,
                          mainFile: f.path,
                          engine: 'pdflatex',
                          revision: project.revision + 1,
                        })
                      }
                    >
                      {f.path}
                    </button>
                  ))}
              </div>
            </>
          )}
          <h3>离线编译</h3>
          <p>
            pdfLaTeX · TeX Live 2023
            <br />
            包含常用宏包、BibTeX 与 CJK 中文字体。仅运行
            pdfLaTeX，不自动切换引擎；不支持依赖外部命令的 shell-escape。
          </p>
          <h3>数据与导出</h3>
          <p>
            项目保存在应用私有目录，覆盖安装保留数据。卸载或清除应用数据会删除项目，请先导出 ZIP
            备份。
          </p>
          {project && pdf && (
            <button
              className="mobile-secondary"
              onClick={() =>
                void exportMobileFile(
                  new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }),
                  project.name + '.pdf',
                ).catch((e) => setNotice(message(e)))
              }
            >
              <Download size={16} />
              保存编译 PDF
            </button>
          )}
          <h3>关于</h3>
          <p>
            Texite {mobilePlatformName} · 0.1.0 alpha
            <br />
            移动首版：项目、源码编辑、离线编译与 PDF。WebDAV 和 AI 连接尚未移植。
          </p>
        </div>
      </Dialog>
    </div>
  );
}
