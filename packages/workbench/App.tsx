import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command,
  FileCode2,
  FilePlus2,
  FileText,
  FolderOpen,
  History,
  Image as ImageIcon,
  LayoutPanelLeft,
  Library,
  LoaderCircle,
  Maximize2,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Square,
  Sun,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { createProject, sampleSource } from '../core/sample';
import {
  getOutline,
  getReferences,
  isTextFile,
  parseDiagnostics,
  safePath,
  validateProject,
  type Engine,
  type Mode,
  type Project,
  type ProjectFile,
} from '../core/model';
import { download, exportZip, importZip, loadProjects, saveProject } from '../platform/storage';
import { SourceEditor, type EditorHandle } from '../editor/SourceEditor';
import { PdfViewer } from '../preview/PdfViewer';
import { Dialog } from '../ui/Dialog';

type Modal = 'projects' | 'new' | 'file' | 'settings' | 'commands' | 'help' | 'rename' | null;
const modes: { id: Mode; label: string; icon: typeof BookOpen }[] = [
  { id: 'write', label: '写作', icon: FileCode2 },
  { id: 'proof', label: '校对', icon: BookOpen },
  { id: 'focus', label: '专注', icon: Maximize2 },
];
const engineNames: Record<Engine, string> = {
  xelatex: 'XeLaTeX',
  pdflatex: 'pdfLaTeX',
  lualatex: 'LuaLaTeX',
};
const friendlyError = (e: unknown) => (e instanceof Error ? e.message : '操作失败，请重试。');

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const [projects, setProjects] = useState<Project[]>([]);
  const [mode, setMode] = useState<Mode>('write');
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 760);
  const [section, setSection] = useState<'files' | 'references' | 'search'>('files');
  const [theme, setTheme] = useState(() => localStorage.getItem('texite-theme') || 'light');
  const [fontSize, setFontSize] = useState(14);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [modalError, setModalError] = useState('');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [saved, setSaved] = useState<'saving' | 'saved' | 'error'>('saving');
  const [cursor, setCursor] = useState({
    line: 1,
    column: 1,
    reference: undefined as string | undefined,
  });
  const [pdf, setPdf] = useState<Uint8Array | null>(null);
  const [pdfLabel, setPdfLabel] = useState('');
  const [pdfRevision, setPdfRevision] = useState(-1);
  const [compiling, setCompiling] = useState(false);
  const [log, setLog] = useState('');
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [engineStatus, setEngineStatus] = useState<Awaited<
    ReturnType<NonNullable<Window['texite']>['detectEngines']>
  > | null>(null);
  const [editorRatio, setEditorRatio] = useState(52);
  const [dragging, setDragging] = useState(false);
  const editor = useRef<EditorHandle>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const assetInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const saveQueue = useRef(Promise.resolve());
  const compileRunning = useRef(false);
  const compileToken = useRef(0);
  const latestText = useRef<ProjectFile | null>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4500);
  }, []);
  const persist = useCallback(
    (snapshot: Project) => {
      setSaved('saving');
      const task = saveQueue.current.catch(() => {}).then(() => saveProject(snapshot));
      saveQueue.current = task;
      task
        .then(() => {
          if (
            projectRef.current?.id === snapshot.id &&
            projectRef.current.revision === snapshot.revision
          )
            setSaved('saved');
          setProjects((items) => [snapshot, ...items.filter((p) => p.id !== snapshot.id)]);
        })
        .catch(() => {
          setSaved('error');
          notify('本地保存失败。请立即导出 ZIP 备份项目。');
        });
      return task;
    },
    [notify],
  );
  useEffect(() => {
    let cancelled = false;
    loadProjects()
      .then((data) => {
        if (cancelled) return;
        setProjects(data.projects);
        setProject(
          data.projects.find((p) => p.id === data.lastId) ?? data.projects[0] ?? createProject(),
        );
      })
      .catch((e) => {
        if (!cancelled) {
          setSaved('error');
          notify('无法读取本地项目：' + friendlyError(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [notify]);
  useEffect(() => {
    if (!project) return;
    setSaved('saving');
    const timer = setTimeout(() => void persist(project), 350);
    return () => clearTimeout(timer);
  }, [project, persist]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (saved !== 'saved') {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saved]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('texite-theme', theme);
  }, [theme]);
  useEffect(
    () => () => {
      clearTimeout(toastTimer.current);
    },
    [],
  );
  useEffect(
    () =>
      window.texite?.onCompileLog((chunk) => setLog((text) => (text + chunk).slice(-1_000_000))),
    [],
  );
  useEffect(() => {
    if (!project) return;
    const id = project.id;
    setPdf(null);
    setPdfLabel('');
    setPdfRevision(-1);
    setLog('');
    setDiagnosticsOpen(false);
    latestText.current = null;
    setCursor({ line: 1, column: 1, reference: undefined });
    if (project.files.find((f) => f.path === 'main.tex')?.content === sampleSource) {
      fetch('./sample.pdf')
        .then((r) => {
          if (!r.ok || !r.headers.get('content-type')?.includes('application/pdf'))
            throw new Error();
          return r.arrayBuffer();
        })
        .then((data) => {
          if (projectRef.current?.id === id) {
            setPdf(new Uint8Array(data));
            setPdfLabel('预编译示例');
            setPdfRevision(project.revision);
          }
        })
        .catch(() => {});
    }
  }, [project?.id]);
  const update = useCallback(
    (change: (p: Project) => Project) =>
      setProject((p) =>
        p ? { ...change(p), revision: p.revision + 1, updatedAt: Date.now() } : p,
      ),
    [],
  );
  const changeFile = useCallback(
    (content: string, path: string) =>
      update((p) => ({
        ...p,
        files: p.files.map((f) => (f.path === path && !f.binary ? { ...f, content } : f)),
      })),
    [update],
  );
  const onCursor = useCallback(
    (line: number, column: number, reference?: string) => setCursor({ line, column, reference }),
    [],
  );
  const openModal = (name: Modal, value = '') => {
    setModalError('');
    setInput(value);
    setQuery('');
    setModal(name);
  };
  async function chooseProject(next: Project) {
    if (compileRunning.current) {
      notify('请等待或取消当前编译后再切换项目。');
      return;
    }
    if (projectRef.current) await persist(projectRef.current);
    setProject(next);
    setModal(null);
  }
  async function exportProject() {
    if (!projectRef.current) return;
    try {
      download(
        await exportZip(projectRef.current),
        projectRef.current.name.replace(/[<>:"/\\|?*]/g, '_') + '.zip',
      );
      notify('项目已导出，包含源码与资源文件。');
    } catch (e) {
      notify(friendlyError(e));
    }
  }
  async function save() {
    const snapshot = projectRef.current;
    if (!snapshot) return;
    try {
      await persist(snapshot);
      if (window.texite) {
        const result = await window.texite.saveProject(snapshot);
        if (!result.cancelled) notify('项目文件已保存到 ' + result.directory);
      } else notify('已保存到此浏览器。导出 ZIP 可另存或迁移项目。');
    } catch (e) {
      notify(friendlyError(e));
    }
  }
  async function openDirectory() {
    if (!window.texite) {
      zipInput.current?.click();
      return;
    }
    try {
      if (compileRunning.current) {
        notify('请先取消编译。');
        return;
      }
      const data = await window.texite.openProject();
      if (data)
        await chooseProject(
          validateProject({
            ...data,
            activeFile: data.mainFile,
            revision: 0,
            updatedAt: Date.now(),
          }),
        );
    } catch (e) {
      notify(friendlyError(e));
    }
  }
  const compile = useCallback(async () => {
    const snapshot = projectRef.current;
    if (!snapshot || compileRunning.current) return;
    if (!window.texite) {
      setModal('settings');
      setModalError(
        '网页版初版支持编辑、保存和 PDF 查看。LaTeX 编译请使用桌面版；浏览器 WASM 引擎将在后续接入。',
      );
      return;
    }
    compileRunning.current = true;
    const token = ++compileToken.current;
    setCompiling(true);
    setLog('');
    try {
      await persist(snapshot);
      const result = await window.texite.compile(snapshot);
      if (projectRef.current?.id !== snapshot.id || compileToken.current !== token) return;
      setLog(result.log);
      if (result.success && result.pdf) {
        setPdf(new Uint8Array(result.pdf));
        setPdfRevision(result.revision);
        setPdfLabel(engineNames[snapshot.engine]);
        notify('编译完成，PDF 已更新。');
      } else if (result.cancelled) notify('编译已取消，上次预览已保留。');
      else {
        setDiagnosticsOpen(true);
        notify('编译未完成，请查看诊断信息。');
      }
    } catch (e) {
      setLog(friendlyError(e));
      setDiagnosticsOpen(true);
    } finally {
      compileRunning.current = false;
      setCompiling(false);
    }
  }, [notify, persist]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setModal('commands');
        setQuery('');
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void compile();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const bounds = workspace.current?.getBoundingClientRect();
      if (bounds)
        setEditorRatio(
          Math.max(28, Math.min(72, (100 * (event.clientX - bounds.left)) / bounds.width)),
        );
    };
    const stop = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
  }, [dragging]);
  const active = project?.files.find((f) => f.path === project.activeFile) ?? project?.files[0];
  if (active && !active.binary) latestText.current = active;
  const textFile =
    active && !active.binary
      ? active
      : (latestText.current ?? project?.files.find((f) => !f.binary));
  const outline = useMemo(
    () => getOutline(active?.binary ? '' : (active?.content ?? '')),
    [active],
  );
  const references = useMemo(() => getReferences(project?.files ?? []), [project?.files]);
  const selectedReference = references.find((r) => r.key === cursor.reference);
  const diagnostics = useMemo(() => parseDiagnostics(log), [log]);
  const matches = useMemo(
    () =>
      query && section === 'search'
        ? (project?.files
            .filter((f) => !f.binary)
            .flatMap((f) =>
              f.content
                .split('\n')
                .flatMap((text, index) =>
                  text.toLowerCase().includes(query.toLowerCase())
                    ? [{ file: f.path, line: index + 1, text }]
                    : [],
                ),
            )
            .slice(0, 80) ?? [])
        : [],
    [query, section, project?.files],
  );
  const selectFile = (path: string) => setProject((p) => (p ? { ...p, activeFile: path } : p));
  function jumpLine(file: string, line: number) {
    selectFile(file);
    setTimeout(() => {
      const content = projectRef.current?.files.find((f) => f.path === file)?.content ?? '';
      const pos = content
        .split('\n')
        .slice(0, line - 1)
        .reduce((a, s) => a + s.length + 1, 0);
      editor.current?.jump(pos);
    }, 0);
  }
  async function addAssets(files: FileList | null) {
    if (!files || !project) return;
    try {
      let total = project.files.reduce((n, f) => n + f.content.length, 0);
      const additions: ProjectFile[] = [];
      for (const file of Array.from(files)) {
        if (total + file.size * 1.4 > 70 * 1024 * 1024) throw new Error('项目大小超过初版上限。');
        const path = safePath(file.name);
        if (project.files.some((f) => f.path.toLowerCase() === path.toLowerCase()))
          throw new Error(path + ' 已存在，请先重命名。');
        total += file.size * 1.4;
        if (isTextFile(path)) additions.push({ path, content: await file.text() });
        else {
          const content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          additions.push({ path, content, binary: true });
        }
      }
      if (project.files.length + additions.length > 500) throw new Error('最多支持 500 个文件。');
      update((p) => ({
        ...p,
        files: [...p.files, ...additions],
        activeFile: additions[0]?.path ?? p.activeFile,
      }));
      notify('文件已加入项目。');
    } catch (e) {
      notify(friendlyError(e));
    }
  }
  const actions = [
    { label: '编译文稿', detail: 'Ctrl / ⌘ Enter', run: () => void compile() },
    {
      label: '打开项目',
      detail: window.texite ? '选择文件夹' : '导入 ZIP',
      run: () => void openDirectory(),
    },
    { label: '导出项目 ZIP', detail: '完整备份', run: () => void exportProject() },
    { label: '查找与替换', detail: '当前文件', run: () => editor.current?.search() },
    {
      label: '切换专注模式',
      detail: '沉浸写作',
      run: () => setMode((m) => (m === 'focus' ? 'write' : 'focus')),
    },
    {
      label: '切换浅色 / 深色',
      detail: '外观',
      run: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')),
    },
  ];
  if (!project)
    return (
      <div className="boot">
        <div className="brand-symbol">t.</div>
        <p>
          {saved === 'error' ? '无法读取工作区，请检查浏览器存储权限。' : '正在打开你的写作空间…'}
        </p>
        {saved === 'error' && (
          <button onClick={() => setProject(createProject())}>创建临时项目</button>
        )}
      </div>
    );
  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
      <div className={'app-shell' + (reduceMotion ? ' reduce-motion' : '')} data-mode={mode}>
        <input
          ref={zipInput}
          type="file"
          accept=".zip"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file)
              try {
                await chooseProject(await importZip(file));
                notify('项目已导入。');
              } catch (e) {
                notify(friendlyError(e));
              }
          }}
        />
        <input
          ref={assetInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            void addAssets(event.target.files);
            event.target.value = '';
          }}
        />
        <input
          ref={pdfInput}
          type="file"
          accept="application/pdf"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) {
              if (file.size > 50 * 1024 * 1024) {
                notify('PDF 不能超过 50 MB。');
                return;
              }
              setPdf(new Uint8Array(await file.arrayBuffer()));
              setPdfLabel('导入的 PDF');
              setPdfRevision(-1);
            }
          }}
        />
        <nav className="activity-rail" aria-label="主导航">
          <button
            className="brand-symbol"
            aria-label="项目首页"
            onClick={() => openModal('projects')}
          >
            t.
          </button>
          <div className="rail-group">
            <button
              className={section === 'files' ? 'active' : ''}
              aria-label="项目文件"
              title="项目文件"
              onClick={() => {
                setSection('files');
                setSidebar(true);
              }}
            >
              <LayoutPanelLeft size={20} />
            </button>
            <button
              className={section === 'search' ? 'active' : ''}
              aria-label="项目搜索"
              title="项目搜索"
              onClick={() => {
                setSection('search');
                setQuery('');
                setSidebar(true);
              }}
            >
              <Search size={20} />
            </button>
            <button
              className={section === 'references' ? 'active' : ''}
              aria-label="参考文献"
              title="参考文献"
              onClick={() => {
                setSection('references');
                setSidebar(true);
              }}
            >
              <Library size={20} />
            </button>
          </div>
          <div className="rail-bottom">
            <button
              aria-label="切换主题"
              title="切换主题"
              onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            >
              {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
            </button>
            <button aria-label="设置" title="设置" onClick={() => openModal('settings')}>
              <Settings2 size={19} />
            </button>
            <button
              className="avatar"
              aria-label="本地工作区说明"
              onClick={() => openModal('help')}
            >
              本地
            </button>
          </div>
        </nav>
        <div className="main-shell">
          <header className="app-header">
            <div className="breadcrumb">
              <button onClick={() => openModal('projects')}>我的工作区</button>
              <ChevronRight size={13} />
              <button className="project-title" onClick={() => openModal('rename', project.name)}>
                {project.name}
                <ChevronDown size={13} />
              </button>
              <span className="local-badge">
                <span />
                仅在本地
              </span>
            </div>
            <div className="header-actions">
              <button className="command-trigger" onClick={() => openModal('commands')}>
                <Search size={14} />
                <span>搜索与命令</span>
                <kbd>⌘ K</kbd>
              </button>
              <button
                className="icon-button"
                aria-label="帮助"
                title="帮助"
                onClick={() => openModal('help')}
              >
                <CircleHelp size={18} />
              </button>
              <button className="export-button" onClick={() => void exportProject()}>
                <ArrowDownToLine size={15} />
                <span>导出项目</span>
              </button>
            </div>
          </header>
          <div className="workspace-heading">
            <div>
              <span className="eyebrow">A LITTLE SPACE FOR BIG IDEAS</span>
              <h1>
                {mode === 'focus'
                  ? '此刻，只专注于想法。'
                  : mode === 'proof'
                    ? '让每一个细节，恰到好处。'
                    : '给想法，留一点空间。'}
              </h1>
            </div>
            <div className="workspace-actions">
              <div className="mode-switch" role="group" aria-label="工作模式">
                {modes.map((item) => (
                  <button
                    key={item.id}
                    className={mode === item.id ? 'selected' : ''}
                    aria-pressed={mode === item.id}
                    onClick={() => setMode(item.id)}
                  >
                    {mode === item.id && (
                      <motion.span
                        className="mode-highlight"
                        layoutId="mode-highlight"
                        transition={{ type: 'spring', bounce: 0.12, duration: 0.28 }}
                      />
                    )}
                    <item.icon size={14} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              <button
                className={'compile-button' + (compiling ? ' compiling' : '')}
                onClick={() => (compiling ? void window.texite?.cancelCompile() : void compile())}
              >
                {compiling ? <Square size={14} /> : <Play size={14} fill="currentColor" />}
                <span>{compiling ? '取消编译' : '编译文稿'}</span>
                <kbd>{compiling ? <LoaderCircle size={12} className="spin" /> : '⌘ ↵'}</kbd>
              </button>
            </div>
          </div>
          <div className={'workbench-row' + (!sidebar ? ' sidebar-hidden' : '')}>
            <aside
              className="project-sidebar"
              aria-label="项目导航"
              hidden={!sidebar || mode === 'focus'}
            >
              <div className="sidebar-heading">
                <span>
                  {section === 'files'
                    ? '项目文件'
                    : section === 'search'
                      ? '项目搜索'
                      : '参考文献'}
                </span>
                <div>
                  {section === 'files' && (
                    <>
                      <button
                        className="icon-button"
                        aria-label="添加文件"
                        title="添加文件"
                        onClick={() => openModal('file')}
                      >
                        <Plus size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="导入资源"
                        title="导入资源"
                        onClick={() => assetInput.current?.click()}
                      >
                        <Upload size={14} />
                      </button>
                    </>
                  )}
                  <button
                    className="icon-button"
                    aria-label="收起侧栏"
                    onClick={() => setSidebar(false)}
                  >
                    <PanelLeftClose size={14} />
                  </button>
                </div>
              </div>
              {section === 'files' ? (
                <>
                  <button className="project-folder" onClick={() => void openDirectory()}>
                    <FolderOpen size={15} />
                    <span>{project.name}</span>
                    <ChevronDown size={12} />
                  </button>
                  <div className="file-tree">
                    {project.files.map((file) => (
                      <button
                        key={file.path}
                        className={active?.path === file.path ? 'selected' : ''}
                        onClick={() => selectFile(file.path)}
                        title={file.path}
                      >
                        {file.binary ? (
                          <ImageIcon size={15} />
                        ) : file.path.endsWith('.bib') ? (
                          <Library size={15} />
                        ) : (
                          <FileCode2 size={15} />
                        )}
                        <span>{file.path}</span>
                        {file.path === project.mainFile && (
                          <span className="main-dot" title="主文件" />
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="outline-heading">
                    <span>文档脉络</span>
                    <span>{outline.length.toString().padStart(2, '0')}</span>
                  </div>
                  <div className="outline-list">
                    {outline.length ? (
                      outline.map((item, index) => (
                        <button
                          key={item.position}
                          className={item.level === 2 ? 'subsection' : ''}
                          onClick={() => editor.current?.jump(item.position)}
                        >
                          <span>{item.level === 1 ? String(index + 1).padStart(2, '0') : '·'}</span>
                          {item.title}
                        </button>
                      ))
                    ) : (
                      <p className="sidebar-empty">章节标题会出现在这里。</p>
                    )}
                  </div>
                </>
              ) : section === 'references' ? (
                <div className="reference-list">
                  {references.length ? (
                    references.map((r) => (
                      <button
                        key={r.key}
                        onClick={() => {
                          editor.current?.insert(`\\cite{${r.key}}`);
                          notify('引用已插入光标位置。');
                        }}
                      >
                        <span className="reference-year">{r.year || '文献'}</span>
                        <strong>{r.title}</strong>
                        <small>{r.key}</small>
                        <span className="reference-insert">
                          插入引用 <ArrowUpRight size={12} />
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="sidebar-empty">添加 .bib 文件，管理和插入引用。</p>
                  )}
                </div>
              ) : (
                <div className="project-search">
                  <label>
                    <Search size={15} />
                    <input
                      aria-label="搜索项目内容"
                      placeholder="查找文字…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  {matches.map((match, i) => (
                    <button key={i} onClick={() => jumpLine(match.file, match.line)}>
                      <strong>
                        {match.file} : {match.line}
                      </strong>
                      <span>{match.text}</span>
                    </button>
                  ))}
                  {query && !matches.length && <p className="sidebar-empty">没有找到匹配内容。</p>}
                </div>
              )}
              <div className="sidebar-bottom">
                <div className="quiet-tip">
                  <Sparkles size={15} />
                  <p>
                    好想法，从一行开始。
                    <br />
                    <span>让写作保持自己的节奏。</span>
                  </p>
                </div>
                <button onClick={() => openModal('projects')}>
                  <History size={14} />
                  最近项目
                  <ArrowUpRight size={13} />
                </button>
              </div>
            </aside>
            <div
              className={'workspace' + (dragging ? ' resizing' : '')}
              ref={workspace}
              style={
                {
                  '--editor-ratio': `${mode === 'proof' ? 36 : editorRatio}%`,
                } as React.CSSProperties
              }
            >
              <section className="editor-pane" aria-label="编辑区域">
                <div className="pane-heading">
                  <div>
                    {(!sidebar || mode === 'focus') && (
                      <button
                        className="icon-button"
                        aria-label="展开侧栏"
                        onClick={() => {
                          setSidebar(true);
                          if (mode === 'focus') setMode('write');
                        }}
                      >
                        <PanelLeftOpen size={15} />
                      </button>
                    )}
                    <span className="editor-tab">
                      <FileCode2 size={15} />
                      {active?.path}
                      <span className="tab-dot" />
                    </span>
                  </div>
                  <div className="editor-tools">
                    <button
                      className="icon-button"
                      aria-label="查找与替换"
                      title="查找与替换"
                      onClick={() => editor.current?.search()}
                    >
                      <Search size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="当前文件操作"
                      title="当前文件操作"
                      onClick={() => openModal('file', active?.path)}
                    >
                      <MoreHorizontal size={17} />
                    </button>
                  </div>
                </div>
                <div className="editor-breadcrumb">
                  <span>{project.name}</span>
                  <ChevronRight size={11} />
                  <span>{active?.path}</span>
                  <span className="editor-language">{active?.binary ? '资源' : 'LaTeX'}</span>
                </div>
                <div className="source-container" hidden={!!active?.binary}>
                  {textFile && (
                    <SourceEditor
                      ref={editor}
                      projectId={project.id}
                      file={textFile}
                      fontSize={fontSize}
                      references={references.map((r) => r.key)}
                      onChange={changeFile}
                      onCursor={onCursor}
                      onCompile={() => void compile()}
                      onSave={() => void save()}
                    />
                  )}
                </div>
                {active?.binary && (
                  <div className="asset-preview">
                    {/\.(png|jpe?g|gif|webp)$/i.test(active.path) ? (
                      <img
                        alt={active.path}
                        src={`data:image/${active.path.split('.').pop()};base64,${active.content}`}
                      />
                    ) : (
                      <FileText size={40} />
                    )}
                    <h3>{active.path}</h3>
                    <p>资源文件随项目一起保存和导出。</p>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        const bytes = Uint8Array.from(atob(active.content), (c) => c.charCodeAt(0));
                        download(new Blob([bytes]), active.path.split('/').pop()!);
                      }}
                    >
                      导出文件
                    </button>
                  </div>
                )}
                <AnimatePresence>
                  {selectedReference && (
                    <motion.div
                      className="citation-lens"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                    >
                      <div className="lens-icon">
                        <Library size={17} />
                      </div>
                      <div>
                        <span>引用透镜 · {selectedReference.year}</span>
                        <strong>{selectedReference.title}</strong>
                        <small>{selectedReference.author}</small>
                      </div>
                      <button
                        className="icon-button"
                        aria-label="关闭引用详情"
                        onClick={() => setCursor((c) => ({ ...c, reference: undefined }))}
                      >
                        <X size={14} />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="editor-footer">
                  <span>
                    <Check size={12} />
                    {active?.binary ? '项目资源' : 'UTF-8'}
                  </span>
                  <span>{active?.content.length.toLocaleString()} 字符</span>
                  <span>
                    行 {cursor.line}，列 {cursor.column}
                  </span>
                </div>
              </section>
              <div
                className="panel-divider"
                role="separator"
                aria-label="调整编辑器宽度"
                aria-orientation="vertical"
                aria-valuemin={28}
                aria-valuemax={72}
                aria-valuenow={editorRatio}
                tabIndex={0}
                onPointerDown={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    setEditorRatio((r) => Math.max(28, r - 3));
                  }
                  if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    setEditorRatio((r) => Math.min(72, r + 3));
                  }
                }}
              >
                <span />
              </div>
              <div className="preview-container">
                <PdfViewer
                  bytes={pdf}
                  label={pdfLabel}
                  stale={!!pdf && pdfRevision >= 0 && pdfRevision !== project.revision}
                  onImport={() => pdfInput.current?.click()}
                />
              </div>
            </div>
          </div>
          <AnimatePresence>
            {diagnosticsOpen && (
              <motion.section
                className="diagnostics"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 220, opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
              >
                <div className="diagnostics-heading">
                  <span>
                    <TriangleAlert size={15} />
                    编译诊断 <small>{diagnostics.length} 条</small>
                  </span>
                  <button
                    className="icon-button"
                    aria-label="关闭诊断"
                    onClick={() => setDiagnosticsOpen(false)}
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="diagnostics-body">
                  {diagnostics.map((d, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        const file =
                          project.files.find(
                            (f) => f.path === d.file || d.file?.endsWith('/' + f.path),
                          )?.path ?? project.mainFile;
                        jumpLine(file, d.line ?? 1);
                      }}
                    >
                      <span className={d.severity}>{d.severity === 'error' ? '错误' : '警告'}</span>
                      <span>{d.message}</span>
                      {d.line && <small>第 {d.line} 行</small>}
                    </button>
                  ))}
                  <details open={!diagnostics.length}>
                    <summary>原始日志</summary>
                    <pre>{log || '尚无编译日志。'}</pre>
                  </details>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
          <footer className="status-bar">
            <div>
              <span className={'save-indicator ' + saved}>
                {saved === 'saved' ? (
                  <CheckCheck size={13} />
                ) : saved === 'saving' ? (
                  <LoaderCircle size={13} className="spin" />
                ) : (
                  <TriangleAlert size={13} />
                )}
                <span>
                  {saved === 'saved'
                    ? '本地恢复副本已保存'
                    : saved === 'saving'
                      ? '正在保存…'
                      : '保存失败 · 请导出备份'}
                </span>
              </span>
              <span className="status-separator" />
              <span>{window.texite ? '桌面工作区' : '浏览器工作区'}</span>
            </div>
            <div>
              <button onClick={() => setDiagnosticsOpen((v) => !v)}>
                <TriangleAlert size={12} />
                {diagnostics.length}
              </button>
              <button onClick={() => openModal('settings')}>
                {engineNames[project.engine]}
                <ChevronDown size={11} />
              </button>
              <span className="version">Texite 0.1</span>
            </div>
          </footer>
        </div>
        <AnimatePresence>
          {toast && (
            <motion.div
              className="toast"
              role="status"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
            >
              <Check size={16} />
              <span>{toast}</span>
              <button aria-label="关闭提示" onClick={() => setToast('')}>
                <X size={14} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <Dialog
          open={modal === 'projects'}
          onClose={() => setModal(null)}
          title="你的写作空间"
          description="所有项目保存在这台设备上。导出 ZIP，可以随时带走。"
          wide
        >
          <div className="project-dialog-actions">
            <button className="primary-button" onClick={() => openModal('new')}>
              <Plus size={16} />
              新建项目
            </button>
            <button className="secondary-button" onClick={() => void openDirectory()}>
              <FolderOpen size={16} />
              {window.texite ? '打开文件夹' : '导入 ZIP'}
            </button>
          </div>
          <div className="project-cards">
            {[project, ...projects.filter((p) => p.id !== project.id)].map((p) => (
              <button
                key={p.id}
                className="project-card"
                onClick={() => void chooseProject(p).catch((e) => notify(friendlyError(e)))}
              >
                <div className="project-cover">
                  <FileText size={32} />
                  <span>LaTeX</span>
                </div>
                <strong>{p.name}</strong>
                <span>
                  {p.files.length} 个文件 · {p.engine}
                </span>
                {p.id === project.id && <small>当前项目</small>}
              </button>
            ))}
          </div>
        </Dialog>
        <Dialog
          open={modal === 'new' || modal === 'rename'}
          onClose={() => setModal(null)}
          title={modal === 'new' ? '一个新想法' : '项目名称'}
          description="名字可以随时更改。"
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!input.trim()) return;
              try {
                if (modal === 'new') await chooseProject(createProject(input.trim(), true));
                else {
                  update((p) => ({ ...p, name: input.trim() }));
                  setModal(null);
                }
              } catch (error) {
                setModalError(friendlyError(error));
              }
            }}
          >
            <label className="form-field">
              项目名称
              <input
                autoFocus
                maxLength={100}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="例如：我的毕业论文"
              />
            </label>
            {modalError && (
              <p className="form-error" role="alert">
                {modalError}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="secondary-button" onClick={() => setModal(null)}>
                取消
              </button>
              <button className="primary-button" disabled={!input.trim()}>
                {modal === 'new' ? '创建项目' : '保存名称'}
              </button>
            </div>
          </form>
        </Dialog>
        <Dialog
          open={modal === 'file'}
          onClose={() => setModal(null)}
          title={input === active?.path ? '当前文件' : '添加文件'}
          description="支持相对路径，例如 chapters/introduction.tex。"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const path = safePath(input.trim());
                if (!isTextFile(path)) throw new Error('请用“导入资源”添加图片、字体和 PDF。');
                if (project.files.some((f) => f.path.toLowerCase() === path.toLowerCase()))
                  throw new Error('这个文件已存在。');
                update((p) => ({
                  ...p,
                  files: [...p.files, { path, content: '' }],
                  activeFile: path,
                }));
                setModal(null);
              } catch (error) {
                setModalError(friendlyError(error));
              }
            }}
          >
            <label className="form-field">
              文件路径
              <input
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="chapters/introduction.tex"
              />
            </label>
            {modalError && (
              <p className="form-error" role="alert">
                {modalError}
              </p>
            )}
            <div className="dialog-actions">
              {active?.path.endsWith('.tex') && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    update((p) => ({ ...p, mainFile: active.path }));
                    setModal(null);
                    notify('已设为编译主文件。');
                  }}
                >
                  将当前文件设为主文件
                </button>
              )}
              <button className="primary-button" disabled={!input.trim() || input === active?.path}>
                创建文件
              </button>
            </div>
          </form>
        </Dialog>
        <Dialog
          open={modal === 'settings'}
          onClose={() => setModal(null)}
          title="让工作区适合你"
          description="外观与本地编译设置。"
        >
          <div className="settings-stack">
            <label className="setting-row">
              <span>
                外观<small>选择适合当前环境的亮度</small>
              </span>
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                <option value="light">晨间 · 浅色</option>
                <option value="dark">夜读 · 深色</option>
              </select>
            </label>
            <label className="setting-row">
              <span>
                编辑器字号<small>{fontSize} px</small>
              </span>
              <input
                aria-label="编辑器字号"
                type="range"
                min={12}
                max={22}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
              />
            </label>
            <label className="setting-row">
              <span>
                减少动态效果<small>保留反馈，减少位移</small>
              </span>
              <input
                type="checkbox"
                checked={reduceMotion}
                onChange={(e) => setReduceMotion(e.target.checked)}
              />
            </label>
            <label className="setting-row">
              <span>
                编译引擎<small>中文项目建议使用 XeLaTeX</small>
              </span>
              <select
                value={project.engine}
                onChange={(e) => update((p) => ({ ...p, engine: e.target.value as Engine }))}
              >
                {Object.entries(engineNames).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-row">
              <span>主文件</span>
              <select
                value={project.mainFile}
                onChange={(e) => update((p) => ({ ...p, mainFile: e.target.value }))}
              >
                {project.files
                  .filter((f) => f.path.endsWith('.tex'))
                  .map((f) => (
                    <option value={f.path} key={f.path}>
                      {f.path}
                    </option>
                  ))}
              </select>
            </label>
            <div className="engine-note">
              <span>
                <span className="status-dot" />
                {window.texite ? '使用本机 TeX 环境' : '网页版 · 本地编辑模式'}
              </span>
              <p>
                {window.texite
                  ? '安装 TeX Live / MacTeX，或 MiKTeX 与 Perl。Texite 通过 latexmk 在本机编译，默认关闭 shell escape。'
                  : '初版可编辑、保存、导入导出项目和查看 PDF。浏览器 WASM 编译尚未接入；请在桌面版编译文稿。'}
              </p>
              {window.texite && (
                <button
                  className="secondary-button"
                  onClick={async () => {
                    try {
                      setEngineStatus(await window.texite!.detectEngines());
                    } catch (e) {
                      notify(friendlyError(e));
                    }
                  }}
                >
                  检测编译环境
                </button>
              )}
              {engineStatus && (
                <div className="engine-results">
                  {Object.entries({ latexmk: engineStatus.latexmk, ...engineStatus.engines }).map(
                    ([key, ok]) => (
                      <span key={key}>
                        {ok ? <Check size={13} /> : <X size={13} />} {key}
                      </span>
                    ),
                  )}
                </div>
              )}
            </div>
            {modalError && (
              <p className="form-error" role="alert">
                {modalError}
              </p>
            )}
          </div>
        </Dialog>
        <Dialog open={modal === 'commands'} onClose={() => setModal(null)} title="你想做什么？">
          <div className="command-search">
            <Search size={18} />
            <input
              autoFocus
              aria-label="搜索命令或文件"
              placeholder="搜索命令或文件…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>ESC</kbd>
          </div>
          <div className="command-list">
            {actions
              .filter((a) => a.label.toLowerCase().includes(query.toLowerCase()))
              .map((a) => (
                <button
                  key={a.label}
                  onClick={() => {
                    setModal(null);
                    a.run();
                  }}
                >
                  <Command size={16} />
                  <span>{a.label}</span>
                  <small>{a.detail}</small>
                </button>
              ))}
            {project.files
              .filter((f) => f.path.toLowerCase().includes(query.toLowerCase()))
              .map((f) => (
                <button
                  key={f.path}
                  onClick={() => {
                    selectFile(f.path);
                    setModal(null);
                  }}
                >
                  <FileCode2 size={16} />
                  <span>{f.path}</span>
                  <small>文件</small>
                </button>
              ))}
          </div>
        </Dialog>
        <Dialog
          open={modal === 'help'}
          onClose={() => setModal(null)}
          title="欢迎来到 Texite"
          description="给想法留一点空间，也让每一次修改安心落地。"
        >
          <div className="help-content">
            <p>
              源码会自动保存为这台设备上的恢复副本。浏览器清理站点数据会删除副本，请定期导出
              ZIP。桌面端按保存快捷键，将项目写入文件夹。
            </p>
            <div className="shortcut-row">
              <span>搜索与命令</span>
              <kbd>Ctrl / ⌘ K</kbd>
            </div>
            <div className="shortcut-row">
              <span>编译文稿</span>
              <kbd>Ctrl / ⌘ Enter</kbd>
            </div>
            <div className="shortcut-row">
              <span>保存项目</span>
              <kbd>Ctrl / ⌘ S</kbd>
            </div>
            <div className="shortcut-row">
              <span>查找与替换</span>
              <kbd>Ctrl / ⌘ F</kbd>
            </div>
            <p className="muted">
              初版提供单页 PDF 阅读与源码编辑。SyncTeX 双向定位、PDF 文本搜索、自动编译和浏览器 WASM
              编译仍在后续计划中。
            </p>
            <button
              className="secondary-button"
              onClick={() =>
                void chooseProject(createProject()).catch((e) => notify(friendlyError(e)))
              }
            >
              <Sparkles size={15} />
              打开一份新示例
            </button>
          </div>
        </Dialog>
      </div>
    </MotionConfig>
  );
}
