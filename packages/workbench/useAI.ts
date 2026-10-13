import { useEffect, useRef, useState } from 'react';
import {
  applyAIChanges,
  mergeAIChanges,
  parseAIChanges,
  undoAITask,
  type AIConnection,
  type AIEvent,
  type AITask,
} from '../core/ai';
import { safePath, parseDiagnostics, type Project, type CompileResult } from '../core/model';
import { loadAITasks, saveAITasks } from '../platform/storage';

type Options = {
  projectId?: string;
  getProject(): Project | null;
  getContext(): string;
  getLog(): string;
  compile(): Promise<CompileResult | undefined>;
  mutate(transform: (current: Project) => Project, tasks: AITask[]): Promise<void>;
};
const labels: Record<string, string> = {
  texite_list_files: '查看项目文件',
  texite_read_file: '读取文稿',
  texite_apply_changes: '编辑文稿',
  texite_compile: '编译并检查 PDF',
  texite_get_diagnostics: '分析编译日志',
};
export function useAI(options: Options) {
  const current = useRef(options);
  current.current = options;
  const [tasks, setTasks] = useState<AITask[]>([]);
  const tasksRef = useRef<AITask[]>([]);
  const [connection, setConnection] = useState<AIConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const active = useRef<{
    id: string;
    projectId: string;
    cancelled: boolean;
    readOnly: boolean;
  } | null>(null);
  const operationQueue = useRef(Promise.resolve());
  const journalQueue = useRef(Promise.resolve());
  const journalPaused = useRef(false);
  const journalTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const aiCompiling = useRef(false);
  const replace = (next: AITask[]) => {
    tasksRef.current = next;
    setTasks(next);
  };
  const persist = () => {
    clearTimeout(journalTimer.current);
    if (journalPaused.current) return Promise.resolve();
    const id = current.current.projectId,
      snapshot = tasksRef.current;
    if (!id) return Promise.resolve();
    const result = journalQueue.current.catch(() => {}).then(() => saveAITasks(id, snapshot));
    journalQueue.current = result;
    result.catch((e) => setError('AI 记录保存失败：' + e.message));
    return result;
  };
  const updateTask = (id: string, change: Partial<AITask>, save = true) => {
    replace(tasksRef.current.map((t) => (t.id === id ? { ...t, ...change } : t)));
    if (save) {
      clearTimeout(journalTimer.current);
      journalTimer.current = setTimeout(() => void persist(), 250);
    }
  };
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    replace([]);
    setError('');
    if (!options.projectId) {
      setLoading(false);
      return;
    }
    void loadAITasks(options.projectId)
      .then((saved) => {
        if (!disposed) {
          replace(saved);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!disposed) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
      clearTimeout(journalTimer.current);
    };
  }, [options.projectId]);

  const handleTool = async (event: Extract<AIEvent, { type: 'tool' }>) => {
    const api = window.texite?.ai;
    if (!api) return;
    try {
      const run = active.current;
      const project = current.current.getProject();
      if (
        !run ||
        run.cancelled ||
        run.id !== event.runId ||
        run.projectId !== event.projectId ||
        project?.id !== event.projectId
      )
        throw new Error('任务已停止或当前项目已改变。');
      const args = event.arguments as Record<string, unknown>;
      if (!args || typeof args !== 'object' || Array.isArray(args))
        throw new Error('工具参数无效。');
      const task = tasksRef.current.find((t) => t.id === run.id)!;
      updateTask(run.id, {
        activities: [...task.activities, labels[event.tool] || event.tool].slice(-80),
      });
      let value: unknown;
      switch (event.tool) {
        case 'texite_list_files':
          value = {
            name: project.name,
            mainFile: project.mainFile,
            activeFile: project.activeFile,
            engine: project.engine,
            revision: project.revision,
            files: project.files.map((f) => ({
              path: f.path,
              binary: !!f.binary,
              characters: f.content.length,
            })),
          };
          break;
        case 'texite_read_file': {
          if (typeof args.path !== 'string') throw new Error('需要文件路径。');
          const file = project.files.find((f) => f.path === safePath(args.path as string));
          if (!file || file.binary) throw new Error('文件不存在或不是文本。');
          if (file.content.length > 500000)
            throw new Error('文件超过 500 KB，当前 AI 工具不支持整篇读取。');
          value = { path: file.path, content: file.content, revision: project.revision };
          break;
        }
        case 'texite_apply_changes': {
          if (run.readOnly) throw new Error('此任务为只读模式。');
          const changes = parseAIChanges(args.changes);
          const latest = tasksRef.current.find((t) => t.id === run.id)!;
          const merged = mergeAIChanges(latest.changes, changes);
          const next = tasksRef.current.map((t) =>
            t.id === run.id ? { ...t, changes: merged } : t,
          );
          await persist();
          if (run.cancelled) throw new Error('任务已停止。');
          journalPaused.current = true;
          try {
            await current.current.mutate((p) => {
              if (p.id !== run.projectId || run.cancelled)
                throw new Error('任务已停止或项目已改变。');
              return applyAIChanges(p, changes);
            }, next);
            updateTask(run.id, { changes: merged }, false);
          } catch (e) {
            // A disk conflict may follow a successful local commit. Preserve its recovery journal.
            const saved = await loadAITasks(run.projectId);
            const committed = saved.find((t) => t.id === run.id);
            if (committed?.changes.length)
              updateTask(run.id, { changes: committed.changes }, false);
            throw e;
          } finally {
            journalPaused.current = false;
          }
          value = {
            applied: changes.map((c) => c.path),
            revision: current.current.getProject()?.revision,
          };
          break;
        }
        case 'texite_compile': {
          aiCompiling.current = true;
          try {
            const result = await current.current.compile();
            if (!result) throw new Error('编译正在进行或当前不可用，请稍后重试。');
            value = {
              success: result.success,
              engine: result.engine,
              compiler: result.compilerLabel,
              revision: result.revision,
              cancelled: result.cancelled,
              diagnostics: parseDiagnostics(result.log),
              log: result.log.slice(-18000),
            };
          } finally {
            aiCompiling.current = false;
          }
          break;
        }
        case 'texite_get_diagnostics':
          value = {
            log: current.current.getLog().slice(-18000),
            diagnostics: parseDiagnostics(current.current.getLog()),
          };
          break;
        default:
          throw new Error('不支持的 Texite 工具。');
      }
      await api.reply(event.requestId, { success: true, value });
    } catch (e) {
      await api
        .reply(event.requestId, { success: false, value: { error: (e as Error).message } })
        .catch(() => {});
    }
  };
  const events = useRef<(event: AIEvent) => void>(() => {});
  events.current = (event) => {
    if (event.type === 'tool') {
      operationQueue.current = operationQueue.current.catch(() => {}).then(() => handleTool(event));
      return;
    }
    if (event.projectId !== current.current.projectId || event.runId !== active.current?.id) return;
    const task = tasksRef.current.find((t) => t.id === event.runId);
    if (!task) return;
    if (event.type === 'text')
      updateTask(task.id, { reply: (task.reply + event.delta).slice(0, 200000) });
    if (event.type === 'activity')
      updateTask(task.id, { activities: [...task.activities, event.text].slice(-80) });
    if (event.type === 'done') {
      operationQueue.current = operationQueue.current
        .catch(() => {})
        .then(async () => {
          updateTask(event.runId, { status: event.status, error: event.error }, false);
          await persist().catch(() => {});
          if (active.current?.id === event.runId) {
            active.current = null;
            setBusy(false);
          }
        });
    }
  };
  useEffect(() => window.texite?.ai?.onEvent((event) => events.current(event)), []);
  useEffect(
    () => () => {
      clearTimeout(journalTimer.current);
      if (active.current) void window.texite?.ai?.cancel();
    },
    [],
  );

  async function connect() {
    setConnecting(true);
    setError('');
    try {
      setConnection(await window.texite!.ai!.connect());
    } catch (e) {
      setConnection(null);
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  }
  async function chooseBinary() {
    try {
      if (await window.texite?.ai?.chooseBinary()) {
        setConnection(null);
        await connect();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function start(prompt: string, model: string, readOnly: boolean) {
    const project = current.current.getProject();
    if (!project || busy || active.current || loading || !prompt.trim()) return;
    const api = window.texite?.ai;
    if (!api) {
      setError('AI 编辑需要桌面版和本机 Codex。');
      return;
    }
    const task: AITask = {
      id: crypto.randomUUID(),
      prompt: prompt.trim(),
      reply: '',
      status: 'running',
      time: Date.now(),
      changes: [],
      activities: [],
    };
    active.current = { id: task.id, projectId: project.id, readOnly, cancelled: false };
    setBusy(true);
    setError('');
    replace([...tasksRef.current, task]);
    try {
      await persist();
      if (active.current?.id !== task.id || active.current.cancelled) return;
      await api.start({
        projectId: project.id,
        runId: task.id,
        prompt: task.prompt,
        model,
        readOnly,
        context: current.current.getContext(),
      });
    } catch (e) {
      updateTask(task.id, { status: 'failed', error: (e as Error).message }, false);
      await persist().catch(() => {});
      if (active.current?.id === task.id) {
        active.current = null;
        setBusy(false);
      }
      setError((e as Error).message);
    }
  }
  async function cancel() {
    if (!active.current) return;
    const run = active.current;
    run.cancelled = true;
    if (aiCompiling.current) await window.texite?.cancelCompile().catch(() => {});
    try {
      await window.texite?.ai?.cancel();
    } catch (e) {
      setError((e as Error).message);
      await window.texite?.ai?.disconnect().catch(() => {});
    } finally {
      if (active.current?.id === run.id)
        events.current({
          type: 'done',
          runId: run.id,
          projectId: run.projectId,
          status: 'interrupted',
        });
    }
  }
  async function undo(task: AITask) {
    if (busy) return;
    setError('');
    setBusy(true);
    const next = tasksRef.current.map((t) =>
      t.id === task.id ? { ...t, status: 'undone' as const } : t,
    );
    try {
      await persist();
      journalPaused.current = true;
      await current.current.mutate((p) => undoAITask(p, task), next);
      replace(next);
    } catch (e) {
      const saved = await loadAITasks(current.current.projectId!).catch(() => []);
      if (saved.find((t) => t.id === task.id)?.status === 'undone') replace(saved);
      setError((e as Error).message);
    } finally {
      journalPaused.current = false;
      setBusy(false);
    }
  }
  return {
    tasks,
    busy,
    connecting,
    loading,
    connection,
    error,
    connect,
    chooseBinary,
    start,
    cancel,
    undo,
  };
}
export type AIController = ReturnType<typeof useAI>;
