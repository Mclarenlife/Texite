import { migrateAIHistories } from '../platform/storage';
import { Outline } from './Outline';
import { pdfCover } from '../preview/cover';
import { saveProjectCover } from '../platform/storage';
import { Undo2, Redo2 } from 'lucide-react';
import { permanentlyDeleteStoredProject, deleteBrowserFiles } from '../platform/storage';
import { syncFingerprint } from '../core/syncState';
import { SidebarSplit } from '../ui/SidebarSplit';
import { ProjectBackups } from './ProjectBackups';
import { createProjectBackup, type ProjectBackup } from '../platform/storage';
import { forwardNode, findSourceSelection, sourceText, type PdfLocate } from '../preview/sync';
import type { SyncNode } from '../core/model';
import type { InlineScope } from '../core/ai';
import { Filter, Trash2 } from 'lucide-react';
import { SyncSettings } from '../ui/SyncSettings';
import type { WebDAVConfig } from '../core/model';
import { ProjectSpace } from './ProjectSpace';
import { AssetPreview } from '../preview/AssetPreview';
import { archiveProjects, readArchivedProjects, renameStoredProject } from '../platform/storage';
import { Select } from '../ui/Select';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import {
  Cloud,
  RefreshCw,
  Minus,
  Copy,
  ArrowDownToLine,
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
  FolderPlus,
  Columns2,
  History,
  LayoutPanelLeft,
  Library,
  LoaderCircle,
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
import {
  commitRecovery,
  download,
  exportZip,
  importZip,
  loadProjects,
  saveProject,
} from '../platform/storage';
import {
  openBrowserDirectory,
  reopenBrowserProject,
  saveBrowserDirectory,
} from '../platform/storage';
import { SourceEditor, type EditorHandle } from '../editor/SourceEditor';
import { PdfViewer } from '../preview/PdfViewer';
import { CompileDiagnostics } from '../preview/CompileDiagnostics';
import { resolveEditorColors, colorRoles } from '../ui/colors';
import { FileTree } from './FileTree';
import { VisualEditor } from '../editor/VisualEditor';
import { Dialog } from '../ui/Dialog';
import { editorFonts, usePreference } from '../ui/preferences';
import { RuntimeSettings } from '../ui/RuntimeSettings';
import { AppearanceSettings } from '../ui/AppearanceSettings';
import { StorageCleanup } from '../ui/StorageCleanup';
import { clearStoredRecords, type CleanupKind } from '../platform/storage';
import { useEditHistory } from './useEditHistory';
import { changeSummary, type EditRecord, type RestoreRequest } from '../core/history';
import { DiffLines, HistoryReview } from '../editor/HistoryReview';
import { useAI } from './useAI';
import { AIPanel } from '../ui/AIPanel';
import type { AITask } from '../core/ai';
import { commitAIProject } from '../platform/storage';

type Modal =
  'projects' | 'folder' | 'new' | 'file' | 'settings' | 'commands' | 'help' | 'rename' | null;
const modes: { id: Mode; label: string; icon: typeof BookOpen }[] = [
  { id: 'editor', label: '仅编辑器', icon: FileCode2 },
  { id: 'pdf', label: '仅 PDF', icon: BookOpen },
  { id: 'split', label: '拆分', icon: Columns2 },
];
const engineNames: Record<Engine, string> = {
  tectonic: 'Tectonic',
  xelatex: 'XeLaTeX',
  pdflatex: 'pdfLaTeX',
  lualatex: 'LuaLaTeX',
};
const friendlyError = (e: unknown) => (e instanceof Error ? e.message : '操作失败，请重试。');

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [bootError, setBootError] = useState('');
  const projectRef = useRef(project);
  projectRef.current = project;
  const [projects, setProjects] = useState<Project[]>([]);
  const [openedIds, setOpenedIds] = useState<string[]>([]);
  const drafts = useRef(new Map<string, Project>());
  if (project) drafts.current.set(project.id, project);
  const [davConfig, setDavConfig] = useState<WebDAVConfig | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const syncRunning = useRef(false);
  const [settingsTab, setSettingsTab] = useState('appearance');
  useEffect(() => {
    void window.texite?.webdav
      ?.get()
      .then(setDavConfig)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (project) setOpenedIds((ids) => (ids.includes(project.id) ? ids : [...ids, project.id]));
  }, [project?.id]);
  const [mode, setMode] = useState<Mode>('split');
  const [space, setSpace] = useState(false);
  const [inlineRun, setInlineRun] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const [archivedProjects, setArchivedProjects] = useState<string[]>([]);
  const [syncDirty, setSyncDirty] = useState(false);
  const [aiDataRevision, setAIDataRevision] = useState(0);
  useEffect(() => {
    const changed = () => setAIDataRevision((n) => n + 1);
    window.addEventListener('texite-ai-history-updated', changed);
    void migrateAIHistories()
      .then(changed)
      .catch((e) => notify('AI 记录迁移未完成：' + friendlyError(e)));
    return () => window.removeEventListener('texite-ai-history-updated', changed);
  }, []);
  const [backupGeneration, setBackupGeneration] = useState(0);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void Promise.all(
        (davConfig?.projects || [])
          .filter((p) => !archivedProjects.includes(p.id))
          .map(async (binding) => {
            const local =
              project?.id === binding.id ? project : projects.find((p) => p.id === binding.id);
            return !!local && !!binding.hash && (await syncFingerprint(local)) !== binding.hash;
          }),
      )
        .then((values) => {
          if (live) setSyncDirty(values.some(Boolean));
        })
        .catch(() => {});
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [davConfig, project, projects, archivedProjects, aiDataRevision]);
  const [editMode, setEditMode] = useState<'code' | 'visual'>('code');
  const [deleteTarget, setDeleteTarget] = useState<{
    projectId: string;
    path: string;
    folder: boolean;
  } | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const deleteRunning = useRef(false);
  const [undoState, setUndoState] = useState({ undo: false, redo: false });
  const onHistoryState = useCallback(
    (undo: boolean, redo: boolean) =>
      setUndoState((old) => (old.undo === undo && old.redo === redo ? old : { undo, redo })),
    [],
  );
  const [selectedFolder, setSelectedFolder] = useState('');
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 760);
  const [section, setSection] = useState<'files' | 'references' | 'search' | 'history'>('files');
  const [theme, setTheme] = usePreference<string>('appearance', 'system');
  const [palette, setPalette] = usePreference<string>('palette', 'mono');
  const [contrast, setContrast] = usePreference<string>('contrast', 'standard');
  const [fontChoice, setFontChoice] = usePreference<string>('font', 'mono');
  const [textColor, setTextColor] = usePreference<string>('text-color', 'auto');
  const [syntaxKeyword, setSyntaxKeyword] = usePreference<string>('syntax-keyword', 'auto');
  const [syntaxString, setSyntaxString] = usePreference<string>('syntax-string', 'auto');
  const [syntaxComment, setSyntaxComment] = usePreference<string>('syntax-comment', 'auto');
  const [syntaxPunctuation, setSyntaxPunctuation] = usePreference<string>(
    'syntax-punctuation',
    'auto',
  );
  const [fontSize, setFontSize] = usePreference<number>('font-size', 14);
  const [uiSize, setUiSize] = usePreference<string>('ui-size', 'medium');
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--ui-font-scale',
      uiSize === 'large' ? '1.16' : uiSize === 'small' ? '0.92' : '1',
    );
  }, [uiSize]);
  const [reduceMotion, setReduceMotion] = usePreference<boolean>('reduce-motion', false);
  const [sidebarWidth, setSidebarWidth] = usePreference<number>('sidebar-width', 240);
  const editHistory = useEditHistory(project?.id);
  const historyRows = useMemo(
    () =>
      [...editHistory.records, ...editHistory.recoveries]
        .sort((a, b) => b.time - a.time)
        .map((record) => ({ record, summary: changeSummary(record) })),
    [editHistory.records, editHistory.recoveries],
  );
  const [review, setReview] = useState<EditRecord | null>(null);
  const [restoreRequest, setRestoreRequest] = useState<RestoreRequest | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const restoreLock = useRef(false);
  const [restoreError, setRestoreError] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [fileScope, setFileScope] = useState<string[] | null>(null),
    [scopeOpen, setScopeOpen] = useState(false),
    [scopeDraft, setScopeDraft] = useState<string[]>([]);
  const [referenceQuery, setReferenceQuery] = useState('');
  const [clearOpen, setClearOpen] = useState(false),
    [clearFrom, setClearFrom] = useState(''),
    [clearTo, setClearTo] = useState(''),
    [clearError, setClearError] = useState('');
  useEffect(() => {
    setFileScope(null);
    setReferenceQuery('');
    setScopeOpen(false);
    setClearOpen(false);
  }, [project?.id]);
  const [modalError, setModalError] = useState('');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const importRunning = useRef(false);
  const permanentRunning = useRef(false);
  const [saved, setSaved] = useState<'saving' | 'saved' | 'error'>('saving');
  const [cursor, setCursor] = useState({
    line: 1,
    column: 1,
    reference: undefined as string | undefined,
  });
  const [pdf, setPdf] = useState<Uint8Array | null>(null);
  const [syncMap, setSyncMap] = useState<SyncNode[]>([]);
  const [pdfLocate, setPdfLocate] = useState<PdfLocate>();
  const [pdfLabel, setPdfLabel] = useState('');
  const [pdfRevision, setPdfRevision] = useState(-1);
  const [compiling, setCompiling] = useState(false);
  const [compileFailed, setCompileFailed] = useState(false);
  const [log, setLog] = useState('');
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [engineStatus, setEngineStatus] = useState<Awaited<
    ReturnType<NonNullable<Window['texite']>['detectEngines']>
  > | null>(null);
  useEffect(() => {
    if (window.texite)
      void window.texite
        .detectEngines()
        .then(setEngineStatus)
        .catch(() => {});
  }, []);
  const [editorRatio, setEditorRatio] = useState(52);
  const [dragging, setDragging] = useState(false);
  const editor = useRef<EditorHandle>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const assetInput = useRef<HTMLInputElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const saveQueue = useRef(Promise.resolve());
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const compileRunning = useRef(false);
  const compileToken = useRef(0);
  const latestText = useRef<ProjectFile | null>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4500);
  }, []);
  const persist = useCallback(
    (snapshot: Project, duringImport = false) => {
      if (restoreLock.current && !duringImport) return Promise.resolve();
      setSaved('saving');
      const task = saveQueue.current
        .catch(() => {})
        .then(async () => {
          await saveProject(snapshot);
          if (window.texite) {
            const location = await window.texite.saveProject(snapshot);
            if (location.directory && location.directory !== snapshot.location?.directory) {
              snapshot = {
                ...snapshot,
                location: { kind: location.kind || 'managed', directory: location.directory },
              };
              await saveProject(snapshot);
              drafts.current.set(snapshot.id, snapshot);
              setProject((current) =>
                current?.id === snapshot.id ? { ...current, location: snapshot.location } : current,
              );
            }
          } else await saveBrowserDirectory(snapshot);
          await editHistory.flush(snapshot.id);
        });
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
        .catch((error) => {
          setSaved('error');
          notify('保存失败：' + friendlyError(error));
        });
      return task;
    },
    [notify, editHistory.flush],
  );
  useEffect(() => {
    let cancelled = false;
    loadProjects()
      .then(async (data) => {
        if (window.texite?.listProjects) {
          const native = await window.texite.listProjects();
          data.projects = [
            ...data.projects,
            ...native.filter((p) => !data.projects.some((s) => s.id === p.id)),
          ];
        }
        const archived = await readArchivedProjects();
        if (!cancelled) {
          setArchivedProjects(archived);
          if (data.lastId && archived.includes(data.lastId)) setSpace(true);
        }
        return data;
      })
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
          setBootError(friendlyError(e));
          notify('无法读取本地项目：' + friendlyError(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [notify]);
  useEffect(() => {
    if (!project || restoreLock.current) return;
    setSaved('saving');
    autosaveTimer.current = setTimeout(() => void persist(project), 350);
    return () => clearTimeout(autosaveTimer.current);
  }, [project, persist]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (saved !== 'saved' || restoreBusy || (!window.texite && (syncDirty || syncBusy))) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saved, restoreBusy, syncDirty, syncBusy]);
  const closeState = useRef<
    () => Promise<{ unsaved: boolean; unsynced: number; syncing: boolean }>
  >(async () => ({ unsaved: true, unsynced: 0, syncing: false }));
  closeState.current = async () => {
    await ai.flush();
    await migrateAIHistories();
    const config = await window.texite?.webdav?.get();
    const stored = (await loadProjects()).projects;
    const locals = new Map(
      [...stored, ...projects, ...drafts.current.values()].map((p) => [p.id, p]),
    );
    if (projectRef.current) locals.set(projectRef.current.id, projectRef.current);
    const changed = await Promise.all(
      (config?.projects || []).map(async (binding) => {
        const local = locals.get(binding.id);
        return !!local && (!binding.hash || (await syncFingerprint(local)) !== binding.hash);
      }),
    );
    return {
      unsaved: saved !== 'saved' || restoreLock.current,
      unsynced: changed.filter(Boolean).length,
      syncing: syncRunning.current,
    };
  };
  useEffect(() => window.texite?.onCloseRequest?.(() => closeState.current()), []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.palette = palette;
    root.dataset.contrast = contrast;
    root.style.setProperty('--editor-font', editorFonts[fontChoice] || editorFonts.mono);
    root.style.setProperty('--editor-size', `${Math.max(12, Math.min(24, fontSize))}px`);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyColors = () => {
      const resolved = resolveEditorColors(
        {
          text: textColor,
          keyword: syntaxKeyword,
          string: syntaxString,
          comment: syntaxComment,
          punctuation: syntaxPunctuation,
        },
        theme === 'dark' || (theme === 'system' && media.matches),
        palette,
        contrast,
      );
      for (const role of colorRoles) root.style.setProperty(role.variable, resolved[role.id]);
    };
    applyColors();
    media.addEventListener('change', applyColors);
    return () => media.removeEventListener('change', applyColors);
  }, [
    theme,
    palette,
    contrast,
    fontChoice,
    fontSize,
    textColor,
    syntaxKeyword,
    syntaxString,
    syntaxComment,
    syntaxPunctuation,
  ]);
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
    setSyncMap([]);
    setPdfLocate(undefined);
    setPdfLabel('');
    setPdfRevision(-1);
    setLog('');
    setCompileFailed(false);
    setDiagnosticsOpen(false);
    setReview(null);
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
        p && !restoreLock.current
          ? { ...change(p), revision: p.revision + 1, updatedAt: Date.now() }
          : p,
      ),
    [],
  );
  const changeFile = (content: string, path: string) => {
    if (restoreLock.current) return;
    const previous = projectRef.current?.files.find((f) => f.path === path);
    if (previous && !previous.binary) editHistory.record(path, previous.content, content);
    update((p) => ({
      ...p,
      files: p.files.map((f) => (f.path === path && !f.binary ? { ...f, content } : f)),
    }));
  };
  const previewRestore = (record: EditRecord) => {
    const current = projectRef.current;
    const file = current?.files.find((f) => f.path === record.path);
    if (!current || !file || file.binary) return;
    setRestoreError('');
    setRestoreRequest({ projectId: current.id, record, expected: file.content });
  };
  async function confirmRestore() {
    if (ai.busy) {
      notify('请先停止 AI 任务再恢复历史版本。');
      return;
    }
    if (!restoreRequest || restoreLock.current) return;
    const request = restoreRequest;
    restoreLock.current = true;
    clearTimeout(autosaveTimer.current);
    setRestoreBusy(true);
    setRestoreError('');
    const task = saveQueue.current
      .catch(() => {})
      .then(async () => {
        const current = projectRef.current;
        if (!current) throw new Error('当前项目不可用。');
        const { backup, restored } = await commitRecovery(current, request);
        editHistory.rememberRecovery(backup);
        if (projectRef.current?.id === restored.id) {
          projectRef.current = restored;
          setProject(restored);
          setReview(null);
          setEditMode('code');
        }
        setProjects((items) => [restored, ...items.filter((p) => p.id !== restored.id)]);
        setRestoreRequest(null);
        setSaved('saving');
        try {
          if (window.texite) await window.texite.saveProject(restored);
          else await saveBrowserDirectory(restored);
          setSaved('saved');
          notify('已恢复文件；恢复前的版本已单独保存，可从历史记录中找回。');
        } catch (error) {
          setSaved('error');
          notify('已在本地恢复并保留备份，磁盘同步失败：' + friendlyError(error));
        }
      });
    saveQueue.current = task;
    try {
      await task;
    } catch (error) {
      setSaved('error');
      setRestoreError('未执行恢复：' + friendlyError(error) + ' 当前内容保持不变。');
    } finally {
      restoreLock.current = false;
      setRestoreBusy(false);
    }
  }
  const onCursor = useCallback(
    (line: number, column: number, reference?: string) => setCursor({ line, column, reference }),
    [],
  );
  const openModal = (name: Modal, value = '') => {
    if (name === 'projects') {
      setSpace(true);
      return;
    }
    if (name === 'settings') setSettingsTab('appearance');
    setModalError('');
    setInput(value);
    setQuery('');
    setModal(name);
  };
  async function chooseProject(next: Project, refresh = false, alreadyFlushed = false) {
    if (ai.busy) {
      notify('请先停止 AI 任务再切换项目。');
      return;
    }
    if (restoreLock.current) return;
    if (compileRunning.current) {
      notify('请等待或取消当前编译后再切换项目。');
      return;
    }
    // Flush edits before loading another disk snapshot. Preserve recovery on external conflicts.
    await saveQueue.current.catch(() => {});
    if (projectRef.current && !alreadyFlushed) await persist(projectRef.current).catch(() => {});
    if (!refresh && !alreadyFlushed && openedIds.includes(next.id)) {
      next = drafts.current.get(next.id) ?? next;
      refresh = false;
    }
    if (refresh && next.id !== projectRef.current?.id && window.texite?.reopenProject)
      next = (await window.texite.reopenProject(next.id)) ?? next;
    if (refresh && next.id !== projectRef.current?.id && !window.texite)
      next = { ...(await reopenBrowserProject(next)), name: next.name };
    if (archivedProjects.includes(next.id))
      setArchivedProjects(await archiveProjects([next.id], false));
    projectRef.current = next;
    setOpenedIds((ids) => (ids.includes(next.id) ? ids : [...ids, next.id]));
    setProject(next);
    setSelectedFolder('');
    setSpace(false);
    setModal(null);
  }
  async function closeProjectTab(id: string) {
    if (ai.busy || compileRunning.current || restoreLock.current) {
      notify('请先结束当前任务。');
      return;
    }
    if (id === projectRef.current?.id) {
      await prepareSpaceMutation();
      const nextId = openedIds.filter((item) => item !== id).at(-1);
      if (nextId && drafts.current.has(nextId)) await chooseProject(drafts.current.get(nextId)!);
      else setSpace(true);
    }
    setOpenedIds((ids) => ids.filter((item) => item !== id));
  }
  async function syncWorkspace(mode: 'pull' | 'upload' | 'sync', ids: string[] = []) {
    if (syncRunning.current) return;
    syncRunning.current = true;
    setSyncBusy(true);
    let locked = false;
    try {
      const api = window.texite?.webdav;
      const config = await api?.get();
      if (!api || !config?.url) {
        openModal('settings');
        setSettingsTab('sync');
        return;
      }
      if (ai.busy || compileRunning.current || restoreLock.current)
        throw new Error('请先结束 AI、编译或恢复任务。');
      restoreLock.current = true;
      locked = true;
      setRestoreBusy(true);
      clearTimeout(autosaveTimer.current);
      await saveQueue.current;
      const current = projectRef.current;
      if (current) {
        await saveProject(current);
        await window.texite!.saveProject(current);
        await editHistory.flush(current.id);
      }
      await ai.flush();
      await migrateAIHistories();
      const result = await api.batch({ mode, ids, excludedIds: archivedProjects });
      for (const item of result.results)
        if (item.status === 'downloaded' && item.id)
          await window.texite?.ai?.clearHistory?.(item.id);
      ai.reloadHistory();
      setDavConfig(result.config);
      const incoming = result.projects.map(validateProject).map((next) => ({
        ...next,
        revision: Math.max(next.revision, (drafts.current.get(next.id)?.revision ?? 0) + 1),
        activeFile: next.files.some((f) => f.path === drafts.current.get(next.id)?.activeFile)
          ? drafts.current.get(next.id)!.activeFile
          : next.activeFile,
      }));
      // Update open tabs as well as the project list; stale drafts must not overwrite a pull.
      for (const next of incoming) {
        drafts.current.set(next.id, next);
        if (projectRef.current?.id === next.id) {
          projectRef.current = next;
          setProject(next);
          setPdfRevision(-1);
          setReview(null);
        }
      }
      setProjects((items) => [
        ...incoming,
        ...items.filter((p) => !incoming.some((n) => n.id === p.id)),
      ]);
      for (const next of incoming) await saveProject(next);
      if (projectRef.current) await saveProject(projectRef.current);
      setSaved('saved');
      const count = (status: string) => result.results.filter((r) => r.status === status).length;
      const failures = result.results.filter((r) => r.status === 'failed');
      const detail = [
        count('uploaded') ? `上传 ${count('uploaded')} 个` : '',
        count('downloaded') ? `拉取 ${count('downloaded')} 个` : '',
        count('conflict') ? `保留 ${count('conflict')} 个云端冲突副本` : '',
        count('local-only') ? `${count('local-only')} 个项目有本地更改待上传` : '',
      ]
        .filter(Boolean)
        .join('，');
      notify(
        failures.length
          ? `同步部分失败：${failures.map((r) => r.name + '：' + r.error).join('；')}${detail ? '。' + detail : ''}`
          : `同步完成${detail ? '：' + detail : '，云端与本地已检查。'}`,
      );
    } catch (error) {
      notify('同步失败：' + friendlyError(error));
    } finally {
      if (locked) {
        restoreLock.current = false;
        setRestoreBusy(false);
      }
      syncRunning.current = false;
      setSyncBusy(false);
    }
  }
  async function relocateProject() {
    await prepareSpaceMutation();
    restoreLock.current = true;
    setRestoreBusy(true);
    try {
      const next = await window.texite!.storage!.relocate(projectRef.current!);
      projectRef.current = next;
      setProject(next);
      setProjects((items) => [next, ...items.filter((p) => p.id !== next.id)]);
      await saveProject(next);
    } finally {
      restoreLock.current = false;
      setRestoreBusy(false);
    }
  }
  async function detachProjects(ids: string[]) {
    if (syncRunning.current) throw new Error('请等待同步完成。');
    const api = window.texite?.webdav;
    if (!api) throw new Error('停止关联需要桌面版。');
    await prepareSpaceMutation();
    syncRunning.current = true;
    setSyncBusy(true);
    try {
      for (const id of ids) setDavConfig(await api.detach(id));
      notify(`已停止 ${ids.length} 个项目的云端关联，本地和云端文件均保留。`);
    } finally {
      syncRunning.current = false;
      setSyncBusy(false);
    }
  }
  async function prepareSpaceMutation() {
    if (ai.busy || compileRunning.current || restoreLock.current)
      throw new Error('请先结束 AI、编译或恢复任务。');
    clearTimeout(autosaveTimer.current);
    await saveQueue.current;
    if (projectRef.current) await persist(projectRef.current);
  }
  async function prepareBackup() {
    await prepareSpaceMutation();
    if (!projectRef.current) throw new Error('请先打开项目。');
    return structuredClone(projectRef.current);
  }
  async function cleanupStorage(kind: CleanupKind) {
    await prepareSpaceMutation();
    restoreLock.current = true;
    setRestoreBusy(true);
    try {
      if (kind === 'history') {
        await editHistory.clearAll();
        setReview(null);
      } else if (kind === 'ai') await ai.clearHistory(undefined, true);
      else {
        await window.texite?.storage?.clearSyncBackups?.();
        await clearStoredRecords('backups');
        setBackupGeneration((v) => v + 1);
      }
    } finally {
      restoreLock.current = false;
      setRestoreBusy(false);
    }
  }
  async function restoreBackup(backup: ProjectBackup) {
    const current = await prepareBackup();
    if (current.id !== backup.projectId) throw new Error('项目已切换，请重新选择备份。');
    restoreLock.current = true;
    setRestoreBusy(true);
    try {
      await createProjectBackup(current, '还原前自动备份 · ' + (backup.note || '项目备份'));
      const next = validateProject({
        ...backup.project,
        id: current.id,
        name: current.name,
        location: current.location,
        revision: current.revision + 1,
        updatedAt: Date.now(),
      });
      const removals = current.files
        .filter((f) => !next.files.some((n) => n.path === f.path))
        .map((f) => ({ path: f.path, expected: f.content, binary: f.binary }));
      if (window.texite) {
        if (!window.texite.restoreProject) throw new Error('请更新桌面程序以还原项目。');
        await window.texite.restoreProject(next, removals);
      } else await saveBrowserDirectory(next, removals);
      await saveProject(next);
      projectRef.current = next;
      drafts.current.set(next.id, next);
      setProject(next);
      setProjects((ps) => ps.map((p) => (p.id === next.id ? next : p)));
      setReview(null);
      setSaved('saved');
      notify('项目已还原，原来的当前版本已自动备份。');
    } finally {
      restoreLock.current = false;
      setRestoreBusy(false);
    }
  }
  async function deleteFileTarget() {
    if (!deleteTarget || restoreLock.current || deleteRunning.current) return;
    deleteRunning.current = true;
    let locked = false;
    setDeleteError('');
    try {
      const current = await prepareBackup();
      if (current.id !== deleteTarget.projectId)
        throw new Error('项目已切换，请重新选择要删除的文件。');
      const matches = (path: string) =>
        path === deleteTarget.path ||
        (deleteTarget.folder && path.startsWith(deleteTarget.path + '/'));
      const files = current.files.filter((f) => !matches(f.path));
      const next = validateProject({
        ...current,
        files,
        folders: current.folders?.filter((f) => !matches(f)),
        revision: current.revision + 1,
        updatedAt: Date.now(),
      });
      const removedFolders = (current.folders || []).filter(matches);
      if (deleteTarget.folder && !removedFolders.includes(deleteTarget.path))
        removedFolders.push(deleteTarget.path);
      const removals = current.files
        .filter((f) => matches(f.path))
        .map((f) => ({ path: f.path, expected: f.content, binary: f.binary }));
      restoreLock.current = true;
      locked = true;
      setRestoreBusy(true);
      await createProjectBackup(current, '删除前自动备份 · ' + deleteTarget.path);
      if (window.texite) {
        if (!window.texite.restoreProject) throw new Error('请更新桌面程序后重试。');
        await window.texite.restoreProject(next, removals, removedFolders);
      } else await saveBrowserDirectory(next, removals, removedFolders);
      await saveProject(next);
      projectRef.current = next;
      drafts.current.set(next.id, next);
      setProject(next);
      setProjects((ps) => ps.map((p) => (p.id === next.id ? next : p)));
      setReview(null);
      setSelectedFolder('');
      setSaved('saved');
      setDeleteTarget(null);
      notify('已删除，可在备份历史中恢复。');
    } catch (e) {
      setDeleteError(friendlyError(e));
    } finally {
      deleteRunning.current = false;
      if (locked) {
        restoreLock.current = false;
        setRestoreBusy(false);
      }
    }
  }
  async function clearHistory(all: boolean) {
    setClearError('');
    const from = all ? 0 : clearFrom ? new Date(clearFrom).getTime() : 0,
      to = all ? Date.now() : clearTo ? new Date(clearTo).getTime() + 59999 : Date.now();
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
      setClearError('请选择有效的时间范围。');
      return;
    }
    try {
      await prepareSpaceMutation();
      restoreLock.current = true;
      setRestoreBusy(true);
      await editHistory.clear(from, to);
      setReview(null);
      setClearOpen(false);
      notify('修改历史已清空，项目备份仍保留。');
    } catch (e) {
      setClearError(friendlyError(e));
    } finally {
      restoreLock.current = false;
      setRestoreBusy(false);
    }
  }
  function locatePdf(scope: InlineScope) {
    if (!pdf || pdfRevision !== projectRef.current?.revision) {
      notify('请先编译当前文稿，再进行定位。');
      return;
    }
    const line = scope.before.slice(0, scope.from).split('\n').length;
    const node = forwardNode(syncMap, scope.path, line);
    if (!node) {
      notify('当前 PDF 没有源码定位信息，请重新编译。');
      return;
    }
    const text = sourceText(
      scope.to > scope.from
        ? scope.before.slice(scope.from, scope.to)
        : scope.before.split('\n')[line - 1],
    );
    setMode('split');
    setDiagnosticsOpen(false);
    setPdfLocate({ id: Date.now(), node, text });
  }
  function locateSource(point: { page: number; x: number; y: number; text: string }) {
    if (pdfRevision !== projectRef.current?.revision) {
      notify('源码已更新，请重新编译后再定位。');
      return;
    }
    const target = findSourceSelection(syncMap, projectRef.current?.files || [], point);
    if (!target) {
      notify('当前位置没有源码定位信息，请重新编译。');
      return;
    }
    const { file, range } = target;
    selectFile(file.path);
    setEditMode('code');
    setMode('split');
    setTimeout(() => editor.current?.jump(range.from, range.to), 50);
  }
  async function renameSpaceProject(target: Project, name: string) {
    await prepareSpaceMutation();
    if (window.texite?.renameProject) await window.texite.renameProject(target.id, name);
    let next: Project;
    try {
      next = await renameStoredProject(target.id, name);
    } catch (error) {
      await window.texite?.renameProject?.(target.id, target.name).catch(() => {});
      throw error;
    }
    setProjects((items) => items.map((p) => (p.id === next.id ? next : p)));
    drafts.current.set(next.id, next);
    if (projectRef.current?.id === next.id) {
      projectRef.current = next;
      setProject(next);
    }
    notify('项目名称已更新，文件夹名称保持不变。');
  }
  async function permanentlyDeleteProjects(ids: string[], deleteFiles: boolean) {
    if (permanentRunning.current) return;
    permanentRunning.current = true;
    let locked = false;
    try {
      await prepareSpaceMutation();
      if (!ids.length || ids.some((id) => !archivedProjects.includes(id)))
        throw new Error('只能永久删除最近删除中的项目。');
      restoreLock.current = true;
      locked = true;
      setRestoreBusy(true);
      for (const id of ids) {
        await editHistory.flush(id);
        if (window.texite) {
          if (!window.texite.deleteProject) throw new Error('请更新桌面应用后再删除。');
          await window.texite.deleteProject(id, deleteFiles);
        } else if (deleteFiles) await deleteBrowserFiles(id);
        await permanentlyDeleteStoredProject(id);
        drafts.current.delete(id);
        setOpenedIds((values) => values.filter((v) => v !== id));
        setArchivedProjects((values) => values.filter((v) => v !== id));
        setProjects((values) => values.filter((v) => v.id !== id));
        if (projectRef.current?.id === id) {
          const next =
            projects.find((p) => !ids.includes(p.id) && !archivedProjects.includes(p.id)) ||
            createProject('未命名项目', true);
          projectRef.current = next;
          setProject(next);
          await saveProject(next);
        }
      }
      if (window.texite?.webdav) setDavConfig(await window.texite.webdav.get());
      setReview(null);
      setSaved('saved');
      notify('所选项目已永久删除。');
    } finally {
      permanentRunning.current = false;
      if (locked) {
        restoreLock.current = false;
        setRestoreBusy(false);
      }
    }
  }
  async function archiveSpaceProjects(ids: string[], archive: boolean) {
    await prepareSpaceMutation();
    setArchivedProjects(await archiveProjects(ids, archive));
    notify(archive ? '项目已移到最近删除。' : '项目已恢复。');
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
      notify(
        window.texite ? '项目已保存到磁盘。' : '已保存到此浏览器。导出 ZIP 可另存或迁移项目。',
      );
    } catch (e) {
      notify(friendlyError(e));
    }
  }
  async function openDirectory() {
    if (ai.busy) {
      notify('请先停止 AI 任务再打开项目。');
      return;
    }
    try {
      if (compileRunning.current) {
        notify('请先取消编译。');
        return;
      }
      if (projectRef.current) await persist(projectRef.current).catch(() => {});
      const data = window.texite ? await window.texite.openProject() : await openBrowserDirectory();
      if (data)
        await chooseProject(
          validateProject({
            ...data,
            activeFile: data.mainFile,
            revision: 0,
            updatedAt: Date.now(),
          }),
          false,
          true,
        );
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') notify(friendlyError(e));
    }
  }
  const compile = useCallback(async () => {
    const snapshot = projectRef.current;
    if (!snapshot || compileRunning.current || restoreLock.current) return;
    if (!snapshot.mainFile) {
      notify('请先创建 .tex 文件并设为主文件，再编译。');
      return;
    }
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
    setCompileFailed(false);
    setLog('');
    try {
      await saveProject(snapshot);
      const result = await window.texite.compile(snapshot);
      if (projectRef.current?.id !== snapshot.id || compileToken.current !== token) return;
      setLog(result.log);
      setCompileFailed(!result.cancelled && !(result.success && result.pdf));
      if (result.success && result.pdf) {
        setDiagnosticsOpen(false);
        setPdf(new Uint8Array(result.pdf));
        setSyncMap(result.syncMap || []);
        setPdfLocate(undefined);
        setPdfRevision(result.revision);
        setPdfLabel(result.compilerLabel || engineNames[result.engine ?? snapshot.engine]);
        try {
          await saveProjectCover(snapshot.id, await pdfCover(result.pdf));
          notify('编译完成，PDF 已更新。');
        } catch {
          notify('编译完成，但项目封面保存失败，请重新编译重试。');
        }
      } else if (result.cancelled) notify('编译已取消，上次预览已保留。');
      else {
        setDiagnosticsOpen(true);
        setMode((current) => (current === 'editor' ? 'split' : current));
        notify('编译未完成，请查看诊断信息。');
      }
      return result;
    } catch (e) {
      setLog(friendlyError(e));
      setCompileFailed(true);
      setDiagnosticsOpen(true);
      setMode((current) => (current === 'editor' ? 'split' : current));
    } finally {
      compileRunning.current = false;
      setCompiling(false);
    }
  }, [notify, persist]);
  async function mutateAI(transform: (current: Project) => Project, tasks: AITask[]) {
    if (restoreLock.current) throw new Error('项目正在保存恢复版本，请稍后重试。');
    restoreLock.current = true;
    setRestoreBusy(true);
    clearTimeout(autosaveTimer.current);
    const task = saveQueue.current
      .catch(() => {})
      .then(async () => {
        const current = projectRef.current;
        if (!current) throw new Error('当前项目不可用。');
        const next = transform(current);
        const removals = current.files
          .filter((f) => !next.files.some((n) => n.path === f.path))
          .map((f) => ({ path: f.path, expected: f.content }));
        await commitAIProject(current, next, tasks);
        for (const file of next.files) {
          const before = current.files.find((f) => f.path === file.path);
          if (!file.binary && before?.content !== file.content)
            editHistory.record(file.path, before?.content ?? '', file.content);
        }
        projectRef.current = next;
        setProject(next);
        setProjects((items) => [next, ...items.filter((p) => p.id !== next.id)]);
        setReview(null);
        setSaved('saving');
        try {
          if (!window.texite?.saveAIProject) throw new Error('请更新桌面程序以保存 AI 修改。');
          await window.texite.saveAIProject(next, removals);
          setSaved('saved');
        } catch (e) {
          setSaved('error');
          throw new Error('修改和备份已保存在本地，磁盘同步失败：' + friendlyError(e));
        }
      });
    saveQueue.current = task;
    try {
      await task;
    } finally {
      restoreLock.current = false;
      setRestoreBusy(false);
    }
  }
  const ai = useAI({
    blocked: () => syncRunning.current || restoreLock.current,
    projectId: project?.id,
    getSelection: () => editor.current?.scope(),
    getProject: () => projectRef.current,
    getContext: () =>
      JSON.stringify({
        project: projectRef.current?.name,
        activeFile: projectRef.current?.activeFile,
        engine: projectRef.current?.engine,
        selection: editor.current?.selection().slice(0, 50000) || '',
      }),
    getLog: () => log,
    compile,
    mutate: mutateAI,
  });
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
      : (project?.files.find((f) => f.path === latestText.current?.path && !f.binary) ??
        project?.files.find((f) => !f.binary));
  const references = useMemo(() => getReferences(project?.files ?? []), [project?.files]);
  const visibleReferences = references.filter((r) =>
    Object.values(r)
      .join(' ')
      .normalize('NFKC')
      .toLowerCase()
      .includes(referenceQuery.trim().normalize('NFKC').toLowerCase()),
  );
  const selectedReference = references.find((r) => r.key === cursor.reference);
  const diagnostics = useMemo(() => parseDiagnostics(log), [log]);
  const matches = useMemo(
    () =>
      query && section === 'search'
        ? (project?.files
            .filter((f) => !f.binary && (!fileScope || fileScope.includes(f.path)))
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
    [query, section, project?.files, fileScope],
  );
  const selectFile = (path: string) => {
    setReview(null);
    setProject((p) => (p ? { ...p, activeFile: path } : p));
  };
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
  async function importEditorImage(file: File) {
    if (!projectRef.current) throw new Error('请先打开项目。');
    if (!/\.(png|jpe?g|pdf)$/i.test(file.name) || file.size > 10 * 1024 * 1024)
      throw new Error('请选择 10 MB 以内的 PNG、JPEG 或 PDF 图片。');
    const projectId = projectRef.current.id;
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('无法读取图片。'));
      reader.readAsDataURL(file);
    });
    if (projectRef.current?.id !== projectId) throw new Error('项目已切换，请重新导入。');
    const fileName = safePath(file.name.replace(/[{}%#&~^]/g, '_'));
    let imagePath = 'assets/' + fileName;
    let suffix = 1;
    while (projectRef.current.files.some((f) => f.path.toLowerCase() === imagePath.toLowerCase()))
      imagePath = 'assets/' + suffix++ + '-' + fileName;
    if (
      projectRef.current.files.reduce((n, f) => n + f.content.length, 0) + content.length >
      70 * 1024 * 1024
    )
      throw new Error('项目资源大小超过上限。');
    update((p) => ({
      ...p,
      files: [...p.files, { path: imagePath, content, binary: true }],
      folders: [...new Set([...(p.folders || []), 'assets'])],
    }));
    return imagePath;
  }
  async function addAssets(files: FileList | File[] | null, targetFolder = selectedFolder) {
    if (!files?.length || !projectRef.current || importRunning.current) return;
    // File inputs are cleared by their change handler; capture the live FileList before awaiting.
    const inputs = Array.from(files);
    const projectId = projectRef.current.id;
    importRunning.current = true;
    let locked = false;
    try {
      await prepareSpaceMutation();
      const current = projectRef.current!;
      if (current.id !== projectId) throw new Error('项目已切换，请重新导入。');
      restoreLock.current = true;
      locked = true;
      setRestoreBusy(true);
      setImportProgress(0);
      const names = new Set(current.files.map((f) => f.path.toLowerCase()));
      if (current.files.length + inputs.length > 500) throw new Error('最多支持 500 个文件。');
      const total = inputs.reduce((sum, f) => sum + f.size, 0);
      if (
        current.files.reduce((sum, f) => sum + f.content.length, 0) + total * 1.4 >
        70 * 1024 * 1024
      )
        throw new Error('项目大小超过初版上限。');
      const paths = inputs.map((file) => {
        const path = safePath((targetFolder ? targetFolder + '/' : '') + file.name);
        if (names.has(path.toLowerCase())) throw new Error(path + ' 已存在，请先重命名。');
        names.add(path.toLowerCase());
        return path;
      });
      let read = 0;
      const additions: ProjectFile[] = [];
      for (let i = 0; i < inputs.length; i++) {
        const file = inputs[i];
        const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onprogress = (e) =>
            setImportProgress(Math.floor(((read + e.loaded) / Math.max(total, 1)) * 90));
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(new Error(file.name + ' 读取失败。'));
          reader.onabort = () => reject(new Error('文件读取已取消。'));
          reader.readAsArrayBuffer(file);
        });
        if (isTextFile(paths[i]))
          additions.push({ path: paths[i], content: new TextDecoder().decode(bytes) });
        else {
          const data = new Uint8Array(bytes);
          let raw = '';
          for (let n = 0; n < data.length; n += 8192)
            raw += String.fromCharCode(...data.subarray(n, n + 8192));
          additions.push({ path: paths[i], content: btoa(raw), binary: true });
        }
        read += file.size;
        setImportProgress(Math.floor((read / Math.max(total, 1)) * 90));
      }
      const next = validateProject({
        ...current,
        files: [...current.files, ...additions],
        activeFile: additions[0].path,
        revision: current.revision + 1,
        updatedAt: Date.now(),
      });
      setImportProgress(94);
      projectRef.current = next;
      setProject(next);
      setSaved('saving');
      await persist(next, true);
      setImportProgress(100);
      notify('文件已加入项目。');
      await new Promise((resolve) => setTimeout(resolve, 650));
    } catch (e) {
      notify(friendlyError(e));
    } finally {
      importRunning.current = false;
      setImportProgress(null);
      if (locked) {
        restoreLock.current = false;
        setRestoreBusy(false);
      }
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
      label: '切换编辑器 / 拆分视图',
      detail: '视图',
      run: () => setMode((m) => (m === 'editor' ? 'split' : 'editor')),
    },
    {
      label: '切换浅色 / 深色',
      detail: '外观',
      run: () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'),
    },
  ];
  if (!project)
    return (
      <div className="boot">
        <div className="brand-symbol">t.</div>
        <p>
          {saved === 'error'
            ? bootError || '无法读取工作区，请检查浏览器存储权限。'
            : '正在打开项目…'}
        </p>
        {saved === 'error' && (
          <>
            <button onClick={() => location.reload()}>重试打开工作区</button>
            <button onClick={() => setProject(createProject())}>创建临时项目</button>
          </>
        )}
      </div>
    );
  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
      <div className={'app-shell' + (reduceMotion ? ' reduce-motion' : '')} data-view={mode}>
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
                if (ai.busy) throw new Error('请先停止 AI 任务再导入项目。');
                if (compileRunning.current) throw new Error('请先取消编译。');
                let imported = await importZip(file);
                if (window.texite) imported = await window.texite.importProject(imported);
                await chooseProject(imported);
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
        <nav className="activity-rail" aria-label="主导航">
          <div className="rail-group">
            <button
              className={section === 'files' ? 'active' : ''}
              aria-label="项目文件"
              title="项目文件"
              onClick={() => {
                setSpace(false);
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
                setSpace(false);
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
                setSpace(false);
                setSection('references');
                setSidebar(true);
              }}
            >
              <Library size={20} />
            </button>
            <button
              aria-label="修改历史"
              title="修改历史"
              className={section === 'history' ? 'active' : ''}
              onClick={() => {
                setSpace(false);
                setSection('history');
                setSidebar(true);
              }}
            >
              <History size={20} />
            </button>
          </div>
          <div className="rail-bottom">
            <button
              aria-label="切换主题"
              title="切换主题"
              onClick={() =>
                setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light')
              }
            >
              {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
            </button>
            <button aria-label="设置" title="设置" onClick={() => openModal('settings')}>
              <Settings2 size={19} />
            </button>
            <button
              className="sync-rail-button"
              aria-label="WebDAV 同步"
              title={
                syncBusy
                  ? '正在同步…'
                  : syncDirty
                    ? '有本地更改尚未同步，点击同步'
                    : '同步本地云项目并拉取云端项目'
              }
              disabled={syncBusy}
              onClick={() => void syncWorkspace('sync')}
            >
              <RefreshCw size={20} className={syncBusy ? 'spin' : undefined} />
              {syncDirty && (
                <span className="sync-pending-badge" aria-label="有本地更改未同步">
                  !
                </span>
              )}
            </button>
          </div>
        </nav>
        <header
          className={'app-header' + (window.texite?.platform === 'win32' ? ' windows-header' : '')}
        >
          <button
            className="brand-symbol"
            aria-label="项目首页"
            onClick={() => openModal('projects')}
          >
            t.
          </button>
          <div className="project-tabs" role="tablist" aria-label="打开的项目">
            {openedIds
              .filter((id) => !archivedProjects.includes(id))
              .map((id) => {
                const tab =
                  id === project.id
                    ? project
                    : (drafts.current.get(id) ?? projects.find((p) => p.id === id));
                if (!tab) return null;
                return (
                  <div
                    className={'project-tab' + (!space && id === project.id ? ' active' : '')}
                    key={id}
                  >
                    <button
                      role="tab"
                      aria-selected={!space && id === project.id}
                      title={tab.name}
                      onClick={() => void chooseProject(tab).catch((e) => notify(friendlyError(e)))}
                    >
                      {davConfig?.projects.some((p) => p.id === id) ? (
                        <Cloud size={14} />
                      ) : (
                        <FileText size={14} />
                      )}
                      <span>{tab.name}</span>
                    </button>
                    <button
                      aria-label={'关闭项目 ' + tab.name}
                      title="关闭项目选项卡"
                      onClick={() =>
                        void closeProjectTab(id).catch((e) => notify(friendlyError(e)))
                      }
                    >
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
            <button
              className="icon-button"
              aria-label="打开项目空间"
              title="打开项目空间"
              onClick={() => setSpace(true)}
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="header-actions">
            <button
              className="ai-toggle"
              aria-label="AI 助手"
              aria-pressed={aiOpen}
              onClick={() => setAiOpen(!aiOpen)}
            >
              <Sparkles size={16} />
              <span>AI 助手</span>
              {ai.busy && <LoaderCircle size={12} className="spin" />}
            </button>
            <div className="workspace-actions">
              <div className="mode-switch" role="group" aria-label="视图切换">
                {modes.map((item) => (
                  <button
                    key={item.id}
                    aria-label={item.label}
                    title={item.label}
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
                  </button>
                ))}
              </div>
              <button
                aria-label={compiling ? '取消编译' : '编译文稿'}
                className={'compile-button' + (compiling ? ' compiling' : '')}
                onClick={() => (compiling ? void window.texite?.cancelCompile() : void compile())}
              >
                {compiling ? <Square size={14} /> : <Play size={14} fill="currentColor" />}
                <span>{compiling ? '取消编译' : '编译'}</span>
              </button>
            </div>

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
          {window.texite?.platform === 'win32' && (
            <div className="window-controls">
              <button
                title="最小化"
                aria-label="最小化"
                onClick={() => void window.texite?.windowControl?.('minimize')}
              >
                <Minus size={15} />
              </button>
              <button
                title="最大化 / 还原"
                aria-label="最大化或还原"
                onClick={() => void window.texite?.windowControl?.('maximize')}
              >
                <Copy size={13} />
              </button>
              <button
                className="window-close"
                title="关闭窗口"
                aria-label="关闭窗口"
                onClick={() => void window.texite?.windowControl?.('close')}
              >
                <X size={17} />
              </button>
            </div>
          )}
        </header>
        <div className="main-shell" hidden={space}>
          <div
            className={
              'workbench-row' + (!sidebar ? ' sidebar-hidden' : '') + (aiOpen ? ' ai-open' : '')
            }
          >
            <aside
              className="project-sidebar"
              aria-label="项目导航"
              hidden={!sidebar}
              style={{ width: Math.max(200, Math.min(480, sidebarWidth)) }}
            >
              <div className="sidebar-heading">
                <span>
                  {section === 'files'
                    ? '项目文件'
                    : section === 'search'
                      ? '项目搜索'
                      : section === 'history'
                        ? '历史与备份'
                        : '参考文献'}
                </span>
                <div>
                  {section === 'files' && (
                    <>
                      <button
                        className="icon-button"
                        aria-label="添加文件"
                        title="添加文件"
                        onClick={() =>
                          openModal('file', selectedFolder ? selectedFolder + '/' : '')
                        }
                      >
                        <Plus size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="创建文件夹"
                        title="创建文件夹"
                        onClick={() =>
                          openModal('folder', selectedFolder ? selectedFolder + '/' : '')
                        }
                      >
                        <FolderPlus size={15} />
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
                <SidebarSplit
                  id="files-outline-ratio"
                  top={
                    <FileTree
                      project={project}
                      selectedFolder={selectedFolder}
                      onFolder={setSelectedFolder}
                      onFile={selectFile}
                      onImport={(files, folder) => void addAssets(files, folder)}
                      onImportError={notify}
                      onDelete={(path, folder) => {
                        setDeleteError('');
                        setDeleteTarget({ projectId: project.id, path, folder });
                      }}
                    />
                  }
                  bottom={
                    <Outline
                      key={project.id + ':' + active?.path}
                      source={active?.binary ? '' : active?.content || ''}
                      onJump={(position) => editor.current?.jump(position)}
                    />
                  }
                />
              ) : section === 'references' ? (
                <>
                  <label className="sidebar-search-field">
                    <Search size={14} />
                    <input
                      aria-label="搜索参考文献"
                      placeholder="标题、作者或引用键…"
                      value={referenceQuery}
                      onChange={(e) => setReferenceQuery(e.target.value)}
                    />
                  </label>
                  <div className="reference-list">
                    {visibleReferences.length ? (
                      visibleReferences.map((r) => (
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
                </>
              ) : section === 'history' ? (
                <SidebarSplit
                  id="backup-history-ratio"
                  top={
                    <ProjectBackups
                      key={project.id + ':' + backupGeneration}
                      project={project}
                      onPrepare={prepareBackup}
                      onRestore={restoreBackup}
                    />
                  }
                  bottom={
                    <>
                      <div className="sidebar-section-title">
                        <strong>修改历史</strong>
                        <button
                          className="icon-button"
                          aria-label="清空修改历史"
                          title="清空修改历史"
                          onClick={() => {
                            setClearError('');
                            setClearOpen(true);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="history-list">
                        <p className="history-note">普通历史：150 次 / 4 MB · 恢复备份单独保留</p>
                        {editHistory.error && <p role="alert">{editHistory.error}</p>}
                        {!historyRows.length && (
                          <p className="sidebar-empty">
                            开始编辑后，这里会记录修改时间、文件和行号。
                          </p>
                        )}
                        {historyRows.map(({ record, summary }) => {
                          return (
                            <button
                              key={record.id}
                              className={review?.id === record.id ? 'selected' : ''}
                              onClick={() => {
                                setReview(record);
                                setMode((m) => (m === 'pdf' ? 'split' : m));
                                setEditMode('code');
                              }}
                            >
                              <time dateTime={new Date(record.time).toISOString()}>
                                {new Date(record.time).toLocaleString('zh-CN', { hour12: false })}
                              </time>
                              <strong>{record.path}</strong>
                              {record.kind === 'recovery' && (
                                <span className="recovery-badge">恢复前备份</span>
                              )}
                              <span>
                                第 {summary.from}
                                {summary.to !== summary.from ? '–' + summary.to : ''} 行{' '}
                                <ins>+{summary.added}</ins> <del>−{summary.removed}</del>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  }
                />
              ) : (
                <div className="project-search">
                  <button
                    className="search-scope-button"
                    onClick={() => {
                      setScopeDraft(
                        fileScope || project.files.filter((f) => !f.binary).map((f) => f.path),
                      );
                      setScopeOpen(true);
                    }}
                  >
                    <Filter size={14} />
                    {fileScope ? `已限定 ${fileScope.length} 个文件` : '全部文件'}
                    <ChevronDown size={13} />
                  </button>
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
            </aside>
            {sidebar && (
              <div
                className="sidebar-resizer"
                role="separator"
                aria-label="调整侧栏宽度"
                aria-orientation="vertical"
                aria-valuemin={200}
                aria-valuemax={480}
                aria-valuenow={sidebarWidth}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    setSidebarWidth((w) =>
                      Math.max(200, Math.min(480, w + (e.key === 'ArrowRight' ? 16 : -16))),
                    );
                  }
                }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  e.currentTarget.dataset.start = String(e.clientX);
                  e.currentTarget.dataset.width = String(sidebarWidth);
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    setSidebarWidth(
                      Math.max(
                        200,
                        Math.min(
                          480,
                          window.innerWidth * 0.45,
                          Number(e.currentTarget.dataset.width) +
                            e.clientX -
                            Number(e.currentTarget.dataset.start),
                        ),
                      ),
                    );
                }}
                onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
              />
            )}
            <div
              className={'workspace' + (dragging ? ' resizing' : '')}
              ref={workspace}
              style={
                {
                  '--editor-ratio': `${editorRatio}%`,
                } as React.CSSProperties
              }
            >
              <section className="editor-pane" aria-label="编辑区域">
                <div className="pane-heading">
                  <div>
                    {!sidebar && (
                      <button
                        className="icon-button"
                        aria-label="展开侧栏"
                        onClick={() => {
                          setSidebar(true);
                        }}
                      >
                        <PanelLeftOpen size={15} />
                      </button>
                    )}
                    <span className="editor-tab">
                      <FileCode2 size={15} />
                      {review?.path || active?.path}
                      <span className="tab-dot" />
                    </span>
                    <div className="editor-history-actions">
                      <button
                        className="icon-button"
                        aria-label="撤销"
                        title="撤销"
                        disabled={
                          !undoState.undo ||
                          !!active?.binary ||
                          editMode !== 'code' ||
                          !!review ||
                          restoreBusy
                        }
                        onClick={() => editor.current?.undo()}
                      >
                        <Undo2 size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="重做"
                        title="重做"
                        disabled={
                          !undoState.redo ||
                          !!active?.binary ||
                          editMode !== 'code' ||
                          !!review ||
                          restoreBusy
                        }
                        onClick={() => editor.current?.redo()}
                      >
                        <Redo2 size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="editor-tools">
                    {!active?.binary && active?.path.endsWith('.tex') && (
                      <div className="edit-mode-switch" aria-label="编辑模式">
                        <button
                          aria-pressed={editMode === 'code'}
                          onClick={() => {
                            setReview(null);
                            setEditMode('code');
                          }}
                        >
                          Code
                        </button>
                        <button
                          aria-pressed={editMode === 'visual'}
                          onClick={() => {
                            setReview(null);
                            setEditMode('visual');
                          }}
                        >
                          Visual
                        </button>
                      </div>
                    )}
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
                  <span>{review?.path || active?.path}</span>
                  <span className="editor-language">{active?.binary ? '资源' : 'LaTeX'}</span>
                </div>
                {review && (
                  <HistoryReview
                    record={review}
                    onClose={() => setReview(null)}
                    onRestore={() => previewRestore(review)}
                    canRestore={!!project.files.find((f) => f.path === review.path && !f.binary)}
                  />
                )}
                <div
                  className="source-container"
                  hidden={
                    !!review ||
                    !!active?.binary ||
                    (editMode === 'visual' && active?.path.endsWith('.tex'))
                  }
                >
                  {!active && (
                    <div className="preview-empty">
                      <FilePlus2 size={28} />
                      <p>添加文件，开始编辑</p>
                      <button className="secondary-button" onClick={() => openModal('file')}>
                        添加文件
                      </button>
                    </div>
                  )}
                  {textFile && (
                    <SourceEditor
                      onHistoryState={onHistoryState}
                      ref={editor}
                      files={project.files.map((f) => f.path)}
                      labels={project.files
                        .filter((f) => !f.binary)
                        .flatMap((f) =>
                          [...f.content.matchAll(/\\label\{([^}]+)\}/g)].map((m) => m[1]),
                        )}
                      aiBusy={ai.busy}
                      onImportImage={importEditorImage}
                      onLocate={locatePdf}
                      onAI={(prompt, scope) => {
                        setInlineRun((n) => n + 1);
                        setAiOpen(true);
                        void ai.start(prompt, '', false, scope);
                      }}
                      readOnly={restoreBusy}
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
                {!review &&
                  !active?.binary &&
                  active?.path.endsWith('.tex') &&
                  editMode === 'visual' && (
                    <VisualEditor
                      key={project.id + active.path}
                      file={active}
                      files={project.files}
                      onOpenFile={selectFile}
                      onChange={changeFile}
                    />
                  )}
                {!review && active?.binary && (
                  <AssetPreview key={project.id + active.path} file={active} />
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
                  locate={pdfLocate}
                  onLocateSource={locateSource}
                  diagnosticsOpen={diagnosticsOpen}
                  onDiagnosticsChange={setDiagnosticsOpen}
                  diagnosticCount={diagnostics.length}
                  diagnosticSeverity={
                    diagnostics.some((d) => d.severity === 'error') ? 'error' : 'warning'
                  }
                  stale={!!pdf && pdfRevision >= 0 && pdfRevision !== project.revision}
                  diagnostics={
                    <CompileDiagnostics
                      diagnostics={diagnostics}
                      compiling={compiling}
                      failed={compileFailed}
                      log={log}
                      project={project}
                      onNotify={notify}
                      onLocate={(file, line) => {
                        setMode((current) => (current === 'pdf' ? 'split' : current));
                        setEditMode('code');
                        jumpLine(file, line);
                      }}
                    />
                  }
                />
              </div>
            </div>
            {aiOpen && (
              <AIPanel
                ai={ai}
                focusAgent={inlineRun}
                projectName={project.name}
                activeFile={project.activeFile}
                selection={editor.current?.scope()}
                onClose={() => setAiOpen(false)}
              />
            )}
          </div>
          <footer className={'status-bar' + (importProgress !== null ? ' importing' : '')}>
            {importProgress !== null ? (
              <div
                className="import-progress"
                role="progressbar"
                aria-label="文件导入进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={importProgress}
              >
                <div className="import-progress-fill" style={{ width: importProgress + '%' }} />
                <span>导入 {importProgress}%</span>
                <span
                  className="import-progress-inverse"
                  aria-hidden="true"
                  style={{ clipPath: `inset(0 ${100 - importProgress}% 0 0)` }}
                >
                  导入 {importProgress}%
                </span>
              </div>
            ) : (
              <>
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
                </div>
                <div>
                  <button
                    title={pdfLabel ? `上次编译：${pdfLabel}` : undefined}
                    onClick={() => openModal('settings')}
                  >
                    {engineNames[project.engine]}
                    {window.texite && engineStatus
                      ? engineStatus.engines[project.engine]
                        ? ' · 离线'
                        : ' · 未安装'
                      : ''}
                    <ChevronDown size={11} />
                  </button>
                </div>
              </>
            )}
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
        <section className="project-space" hidden={!space} aria-label="项目空间">
          <ProjectSpace
            projects={[project, ...projects.filter((p) => p.id !== project.id)]}
            syncedIds={davConfig?.projects.map((p) => p.id) ?? []}
            archived={archivedProjects}
            syncBusy={syncBusy}
            onSync={() => syncWorkspace('pull')}
            onUpload={(ids) => syncWorkspace('upload', ids)}
            onDetach={detachProjects}
            onOpen={(p) => void chooseProject(p, true).catch((e) => notify(friendlyError(e)))}
            onFolder={() => void openDirectory()}
            onImport={() => zipInput.current?.click()}
            onNew={() => openModal('new')}
            onRename={renameSpaceProject}
            onArchive={archiveSpaceProjects}
            onDelete={permanentlyDeleteProjects}
          />
        </section>
        <Dialog open={scopeOpen} onClose={() => setScopeOpen(false)} title="限定搜索文件">
          <div className="scope-actions">
            <button
              onClick={() =>
                setScopeDraft(project?.files.filter((f) => !f.binary).map((f) => f.path) || [])
              }
            >
              全选
            </button>
            <button onClick={() => setScopeDraft([])}>清除选择</button>
          </div>
          <div className="scope-file-list">
            {project?.files
              .filter((f) => !f.binary)
              .map((f) => (
                <label key={f.path}>
                  <input
                    type="checkbox"
                    checked={scopeDraft.includes(f.path)}
                    onChange={(e) =>
                      setScopeDraft((v) =>
                        e.target.checked ? [...v, f.path] : v.filter((p) => p !== f.path),
                      )
                    }
                  />
                  <FileText size={15} />
                  <span>{f.path}</span>
                </label>
              ))}
          </div>
          <div className="dialog-actions">
            <button
              className="primary-button"
              onClick={() => {
                setFileScope(
                  scopeDraft.length === project?.files.filter((f) => !f.binary).length
                    ? null
                    : scopeDraft,
                );
                setScopeOpen(false);
              }}
            >
              应用范围
            </button>
          </div>
        </Dialog>
        <Dialog
          open={clearOpen}
          onClose={() => !restoreBusy && setClearOpen(false)}
          title="清空修改历史"
          description="仅删除修改记录，项目文件和完整项目备份不受影响。"
        >
          <div className="history-range">
            <label>
              开始时间
              <input
                type="datetime-local"
                aria-label="历史开始时间"
                value={clearFrom}
                onChange={(e) => setClearFrom(e.target.value)}
              />
            </label>
            <label>
              结束时间
              <input
                type="datetime-local"
                aria-label="历史结束时间"
                value={clearTo}
                onChange={(e) => setClearTo(e.target.value)}
              />
            </label>
          </div>
          {clearError && (
            <p role="alert" className="form-error">
              {clearError}
            </p>
          )}
          <div className="dialog-actions">
            <button disabled={restoreBusy} onClick={() => void clearHistory(true)}>
              清空全部历史
            </button>
            <button
              className="primary-button"
              disabled={restoreBusy || (!clearFrom && !clearTo)}
              onClick={() => void clearHistory(false)}
            >
              清空所选时间范围
            </button>
          </div>
        </Dialog>
        <Dialog
          open={modal === 'new' || modal === 'rename'}
          onClose={() => setModal(null)}
          title={modal === 'new' ? '新建项目' : '项目名称'}
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
          open={modal === 'file' || modal === 'folder'}
          onClose={() => setModal(null)}
          title={
            modal === 'folder' ? '创建文件夹' : input === active?.path ? '当前文件' : '添加文件'
          }
          description="支持相对路径，例如 chapters/introduction.tex。"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const path = safePath(input.trim());
                if (modal === 'folder') {
                  const next = validateProject({
                    ...project,
                    folders: [...(project.folders || []), path],
                  });
                  if (validateProject(project).folders?.includes(path))
                    throw new Error('这个文件夹已存在。');
                  update(() => next);
                  setSelectedFolder(path);
                  setModal(null);
                  return;
                }
                if (!isTextFile(path)) throw new Error('请用“导入资源”添加图片、字体和 PDF。');
                if (project.files.some((f) => f.path.toLowerCase() === path.toLowerCase()))
                  throw new Error('这个文件已存在。');
                update((p) =>
                  validateProject({
                    ...p,
                    files: [...p.files, { path, content: '' }],
                    activeFile: path,
                  }),
                );
                setModal(null);
              } catch (error) {
                setModalError(friendlyError(error));
              }
            }}
          >
            <label className="form-field">
              {modal === 'folder' ? '文件夹路径' : '文件路径'}
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
              {modal === 'file' && active?.path.endsWith('.tex') && (
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
                {modal === 'folder' ? '创建文件夹' : '创建文件'}
              </button>
            </div>
          </form>
        </Dialog>
        <Dialog
          open={!!restoreRequest}
          onClose={() => {
            if (!restoreBusy) setRestoreRequest(null);
          }}
          title="预览恢复差异"
          description="仅恢复这一个文件。确认前不会修改内容；确认时会先保存当前版本为独立备份。"
          wide
          className="restore-dialog"
        >
          {restoreRequest && (
            <div className="restore-preview" aria-busy={restoreBusy}>
              <div className="restore-comparison-heading">
                <strong>{restoreRequest.record.path}</strong>
                <span>
                  当前版本 →{' '}
                  {new Date(restoreRequest.record.time).toLocaleString('zh-CN', { hour12: false })}{' '}
                  · {restoreRequest.record.kind === 'recovery' ? '备份版本' : '修改前'}
                </span>
              </div>
              <DiffLines before={restoreRequest.expected} after={restoreRequest.record.before} />
              {restoreRequest.expected === restoreRequest.record.before && (
                <p className="restore-equal">当前内容与目标版本一致，无需恢复。</p>
              )}
              {restoreError && (
                <p className="form-error" role="alert">
                  {restoreError}
                </p>
              )}
              <div className="restore-footer">
                <span>备份会保留在“修改历史”中，可再次预览并恢复。</span>
                <div>
                  <button
                    className="secondary-button"
                    disabled={restoreBusy}
                    onClick={() => setRestoreRequest(null)}
                  >
                    取消
                  </button>
                  <button
                    className="primary-button"
                    disabled={
                      restoreBusy || restoreRequest.expected === restoreRequest.record.before
                    }
                    onClick={() => void confirmRestore()}
                  >
                    {restoreBusy ? '正在保存备份…' : '保留当前版本并恢复'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </Dialog>
        <Dialog
          open={modal === 'settings'}
          onClose={() => setModal(null)}
          title="设置"
          description="外观、编辑器、编译与同步。"
          wide
          className="settings-dialog"
          onEscapeKeyDown={(event) => {
            if (event.target instanceof Element && event.target.closest('.color-studio'))
              event.preventDefault();
          }}
        >
          <AppearanceSettings
            onPrepareUpdate={prepareSpaceMutation}
            theme={theme}
            onTheme={setTheme}
            palette={palette}
            onPalette={setPalette}
            contrast={contrast}
            onContrast={setContrast}
            colors={{
              text: textColor,
              keyword: syntaxKeyword,
              string: syntaxString,
              comment: syntaxComment,
              punctuation: syntaxPunctuation,
            }}
            onColor={(key, value) =>
              ({
                text: setTextColor,
                keyword: setSyntaxKeyword,
                string: setSyntaxString,
                comment: setSyntaxComment,
                punctuation: setSyntaxPunctuation,
              })[key](value)
            }
            font={fontChoice}
            onFont={setFontChoice}
            fontSize={fontSize}
            onFontSize={setFontSize}
            uiSize={uiSize}
            onUiSize={setUiSize}
            reduceMotion={reduceMotion}
            onReduceMotion={setReduceMotion}
            initialTab={modalError ? 'compiler' : settingsTab}
            sync={
              <>
                <SyncSettings
                  project={project}
                  onChange={setDavConfig}
                  onRelocate={relocateProject}
                />
                <StorageCleanup onCleanup={cleanupStorage} />
              </>
            }
          >
            <label className="setting-row">
              <span>
                编译引擎<small>内置引擎无需安装 TeX 环境</small>
              </span>
              <Select
                aria-label="编译引擎"
                value={project.engine}
                onValueChange={(value) => update((p) => ({ ...p, engine: value as Engine }))}
              >
                {Object.entries(engineNames).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="setting-row">
              <span>主文件</span>
              <Select
                aria-label="主文件"
                value={project.mainFile}
                onValueChange={(value) => update((p) => ({ ...p, mainFile: value }))}
              >
                {project.files
                  .filter((f) => f.path.endsWith('.tex'))
                  .map((f) => (
                    <option value={f.path} key={f.path}>
                      {f.path}
                    </option>
                  ))}
              </Select>
            </label>
            <div className="engine-note">
              <span>
                <span className="status-dot" />
                {window.texite ? '内置离线编译环境' : '网页版 · 本地编辑模式'}
              </span>
              <p>
                {window.texite
                  ? '默认搭载真正的 pdfLaTeX（TeX Live 2025），保留中文与常用宏包。所选引擎未安装时会提示导入，不会自动切换。'
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
                  {Object.entries({ ...engineStatus.engines }).map(([key, ok]) => (
                    <span key={key}>
                      {ok ? <Check size={13} /> : <X size={13} />}{' '}
                      {engineStatus.details?.[key as Engine] || `${key} · 未安装`}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {window.texite && (
              <RuntimeSettings
                onChange={() => {
                  void window
                    .texite!.detectEngines()
                    .then(setEngineStatus)
                    .catch((e) => notify(friendlyError(e)));
                }}
              />
            )}
            {modalError && (
              <p className="form-error" role="alert">
                {modalError}
              </p>
            )}
          </AppearanceSettings>
        </Dialog>
        <Dialog
          open={!!deleteTarget}
          onClose={() => {
            if (!restoreBusy) setDeleteTarget(null);
          }}
          title={deleteTarget?.folder ? '删除文件夹？' : '删除文件？'}
          description="此操作会删除项目中的对应内容，删除前会自动备份。关联文件夹中的文件也会从磁盘删除。"
        >
          <p className="delete-target-path">{deleteTarget?.path}</p>
          {deleteTarget?.folder && (
            <p className="delete-target-note">文件夹中的所有子文件夹与文件将一并删除。</p>
          )}
          {deleteError && (
            <p className="form-error" role="alert">
              {deleteError}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="secondary-button"
              disabled={restoreBusy}
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </button>
            <button
              className="primary-button danger-button"
              disabled={restoreBusy}
              onClick={() => void deleteFileTarget()}
            >
              {restoreBusy ? '正在删除…' : '确认删除'}
            </button>
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
        <Dialog open={modal === 'help'} onClose={() => setModal(null)} title="使用帮助">
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
              支持连续 PDF 阅读、Code / Visual 编辑与本地修改历史。SyncTeX 双向定位、PDF
              文本搜索、自动编译和浏览器 WASM 编译仍在后续计划中。
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
