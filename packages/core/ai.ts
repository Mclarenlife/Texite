import { isTextFile, safePath, validateProject, type Project } from './model';

export type AIChange = { path: string; before: string | null; after: string };
export type InlineScope = {
  projectId: string;
  path: string;
  from: number;
  to: number;
  before: string;
};
export function validateInlineChanges(scope: InlineScope, project: Project, changes: AIChange[]) {
  if (
    !Number.isInteger(scope.from) ||
    !Number.isInteger(scope.to) ||
    scope.from < 0 ||
    scope.to < scope.from ||
    scope.to > scope.before.length
  )
    throw new Error('行内编辑范围无效，请重新选择文字。');
  if (scope.projectId !== project.id || changes.length !== 1 || changes[0].path !== scope.path)
    throw new Error('行内 Agent 只能编辑指定文件的选区或光标位置。');
  const change = changes[0];
  const prefix = scope.before.slice(0, scope.from),
    suffix = scope.before.slice(scope.to);
  if (
    !change.after.startsWith(prefix) ||
    !change.after.endsWith(suffix) ||
    change.after.length < prefix.length + suffix.length
  )
    throw new Error('修改超出选区范围，已阻止；请仅替换选中文字或在光标处插入。');
}
export type AITask = {
  id: string;
  conversationId?: string;
  cliName?: string;
  profileId?: string;
  prompt: string;
  reply: string;
  time: number;
  status: 'running' | 'completed' | 'failed' | 'interrupted' | 'undone';
  changes: AIChange[];
  activities: string[];
  error?: string;
  mode?: 'agent' | 'chat';
  provider?: 'codex' | 'api';
  model?: string;
  usage?: AIUsage;
};
export type AIUsage = {
  inputTokens: number;
  outputTokens: number;
  rounds: number;
  reportedRounds: number;
  maxRounds: number;
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
  | {
      type: 'connection';
      reason: 'manual' | 'idle' | 'error' | 'connected';
      connection?: AIConnection;
      error?: string;
    }
  | { type: 'text'; runId: string; projectId: string; delta: string }
  | { type: 'activity'; runId: string; projectId: string; text: string }
  | { type: 'usage'; runId: string; projectId: string; usage: AIUsage }
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
  getIdleSettings?(): Promise<{ idleMinutes: number }>;
  setIdleSettings?(settings: { idleMinutes: number }): Promise<{ idleMinutes: number }>;
  getConfig?(): Promise<AgentConfig>;
  getProfiles?(): Promise<AgentConfig[]>;
  configure?(config: AgentConfig): Promise<AgentConfig>;
  clearHistory?(
    projectId: string | null,
    mode?: 'agent' | 'chat',
    conversationId?: string,
  ): Promise<void>;
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
    conversationId?: string;
  }): Promise<void>;
  cancel(): Promise<void>;
  reply(requestId: string, result: { success: boolean; value: unknown }): Promise<void>;
  onEvent(callback: (event: AIEvent) => void): () => void;
};
export type ChatConfig = {
  id?: string;
  name?: string;
  baseURL: string;
  model: string;
  apiKey?: string;
  hasKey?: boolean;
  persistent?: boolean;
};
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ChatAPI = {
  list?(): Promise<ChatConfig[]>;
  select?(id: string): Promise<ChatConfig>;
  get(): Promise<ChatConfig>;
  save(config: ChatConfig & { clearKey?: boolean }): Promise<ChatConfig>;
  start(input: {
    runId: string;
    projectId: string;
    messages: ChatMessage[];
    agent?: boolean;
    maxRounds?: number;
  }): Promise<void>;
  reply?(requestId: string, result: { success: boolean; value: unknown }): Promise<void>;
  cancel(): Promise<void>;
};
export type AgentConfig = {
  preset: 'codex' | 'claude' | 'qwen' | 'minimax' | 'deepseek' | 'custom';
  protocol: 'codex' | 'acp';
  command: string;
  args: string[];
  model?: string;
};
export type AIConversation = {
  id: string;
  mode: 'agent' | 'chat';
  title: string;
  time: number;
  customTitle?: boolean;
};
export type AIConversations = {
  items: AIConversation[];
  selected: Partial<Record<'agent' | 'chat', string>>;
};
export function selectionLabel(scope?: InlineScope | null) {
  if (!scope || scope.from === scope.to) return '';
  const position = (offset: number) => {
    const prefix = scope.before.slice(0, offset),
      parts = prefix.split('\n');
    return { line: parts.length, column: Array.from(parts.at(-1) || '').length + 1 };
  };
  const start = position(scope.from),
    end = position(scope.to - (scope.before.codePointAt(scope.to - 2)! > 0xffff ? 2 : 1));
  return start.line === end.line
    ? `第 ${start.line} 行，第 ${start.column}–${end.column} 字`
    : `第 ${start.line} 行第 ${start.column} 字 → 第 ${end.line} 行第 ${end.column} 字`;
}

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

export type AIHistory = { version: 1; tasks: AITask[]; conversations: AIConversations };
export type AIHistoryAPI = {
  read(id: string): Promise<AIHistory | null>;
  update(
    id: string,
    patch: Partial<Pick<AIHistory, 'tasks' | 'conversations'>>,
  ): Promise<AIHistory>;
  directory(): Promise<string>;
  choose(): Promise<string | null>;
  clear(): Promise<void>;
};
