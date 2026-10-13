import { isTextFile, safePath, validateProject, type Project } from './model';

export type AIChange = { path: string; before: string | null; after: string };
export type AITask = {
  id: string;
  prompt: string;
  reply: string;
  time: number;
  status: 'running' | 'completed' | 'failed' | 'interrupted' | 'undone';
  changes: AIChange[];
  activities: string[];
  error?: string;
};
export type AIConnection = {
  connected: boolean;
  binary?: string;
  version?: string;
  authenticated?: boolean;
  account?: string;
  models: { id: string; label: string; isDefault: boolean }[];
};
export type AIEvent =
  | { type: 'text'; runId: string; projectId: string; delta: string }
  | { type: 'activity'; runId: string; projectId: string; text: string }
  | {
      type: 'done';
      runId: string;
      projectId: string;
      status: 'completed' | 'failed' | 'interrupted';
      error?: string;
    }
  | {
      type: 'tool';
      runId: string;
      projectId: string;
      requestId: string;
      tool: string;
      arguments: unknown;
    };
export type AIAPI = {
  connect(): Promise<AIConnection>;
  chooseBinary(): Promise<string | null>;
  disconnect(): Promise<void>;
  start(input: {
    projectId: string;
    runId: string;
    prompt: string;
    model: string;
    readOnly: boolean;
    context: string;
  }): Promise<void>;
  cancel(): Promise<void>;
  reply(requestId: string, result: { success: boolean; value: unknown }): Promise<void>;
  onEvent(callback: (event: AIEvent) => void): () => void;
};

export function parseAIChanges(value: unknown): AIChange[] {
  if (!Array.isArray(value) || !value.length || value.length > 30)
    throw new Error('每次修改需要 1–30 个文件。');
  const names = new Set<string>();
  let size = 0;
  return value.map((v) => {
    if (
      !v ||
      typeof v.path !== 'string' ||
      typeof v.after !== 'string' ||
      (v.before !== null && typeof v.before !== 'string')
    )
      throw new Error('修改格式无效，需要 path、before 和 after。');
    const path = safePath(v.path);
    if (!isTextFile(path) || path.split('/').some((part) => part.startsWith('.')))
      throw new Error('AI 只能编辑项目中的文稿文本文件。');
    if (names.has(path.toLowerCase())) throw new Error('同一批修改不能重复包含一个文件。');
    names.add(path.toLowerCase());
    size += (v.before?.length || 0) + v.after.length;
    if (size > 2_000_000) throw new Error('单次 AI 修改超过 2 MB，请分批处理。');
    return { path, before: v.before, after: v.after };
  });
}

export function applyAIChanges(current: Project, changes: AIChange[]): Project {
  const files = current.files.map((f) => ({ ...f }));
  for (const change of parseAIChanges(changes)) {
    const file = files.find((f) => f.path.toLowerCase() === change.path.toLowerCase());
    if (
      file
        ? file.binary || file.path !== change.path || file.content !== change.before
        : change.before !== null
    )
      throw new Error(`${change.path} 已发生变化，请重新读取后修改。`);
    if (file) file.content = change.after;
    else files.push({ path: change.path, content: change.after });
  }
  return validateProject({
    ...current,
    files,
    revision: current.revision + 1,
    updatedAt: Date.now(),
  });
}

export function mergeAIChanges(previous: AIChange[], changes: AIChange[]) {
  const result = previous.map((v) => ({ ...v }));
  for (const change of changes) {
    const old = result.find((v) => v.path === change.path);
    if (old) {
      if (old.after !== change.before)
        throw new Error(`${change.path} 在任务期间被手动编辑，请保留新内容并开始新任务。`);
      old.after = change.after;
    } else result.push({ ...change });
  }
  return result;
}

export function undoAITask(current: Project, task: AITask) {
  if (task.status === 'running' || task.status === 'undone' || !task.changes.length)
    throw new Error('此任务当前不能撤回。');
  const files = current.files.map((f) => ({ ...f }));
  for (const change of task.changes) {
    const index = files.findIndex((f) => f.path === change.path);
    if (index < 0 || files[index].binary || files[index].content !== change.after)
      throw new Error(`${change.path} 在 AI 修改后又被编辑，请先查看差异，避免覆盖新内容。`);
    if (change.before === null) files.splice(index, 1);
    else files[index].content = change.before;
  }
  return validateProject({
    ...current,
    files,
    revision: current.revision + 1,
    updatedAt: Date.now(),
  });
}
