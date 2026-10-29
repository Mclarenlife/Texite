const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const empty = () => ({ version: 1, tasks: [], conversations: { items: [], selected: {} } });
function validateHistory(input) {
  if (
    !input ||
    input.version !== 1 ||
    !Array.isArray(input.tasks) ||
    !input.conversations ||
    !Array.isArray(input.conversations.items) ||
    !input.conversations.selected ||
    Buffer.byteLength(JSON.stringify(input)) > 24_000_000
  )
    throw new Error('AI 对话数据无效或超过 24 MB。');
  const str = (s) => {
    if (typeof s !== 'string') throw new Error('AI 对话文本格式无效。');
    return s;
  };
  const number = (n) => {
    if (!Number.isFinite(n)) throw new Error('AI 对话时间无效。');
    return n;
  };
  const tasks = input.tasks.map((t) => {
    if (
      !['running', 'completed', 'failed', 'interrupted', 'undone'].includes(t.status) ||
      !Array.isArray(t.changes) ||
      !Array.isArray(t.activities)
    )
      throw new Error('AI 任务格式无效。');
    const task = {
      id: str(t.id),
      prompt: str(t.prompt),
      reply: str(t.reply),
      time: number(t.time),
      status: t.status,
      changes: t.changes.map((c) => ({
        path: str(c.path),
        before: c.before === null ? null : str(c.before),
        after: str(c.after),
      })),
      activities: t.activities.map(str),
    };
    for (const key of ['conversationId', 'cliName', 'profileId', 'error', 'model'])
      if (t[key] !== undefined) task[key] = str(t[key]);
    if (t.mode !== undefined) {
      if (!['agent', 'chat'].includes(t.mode)) throw new Error('AI 模式无效。');
      task.mode = t.mode;
    }
    if (t.provider !== undefined) {
      if (!['codex', 'api'].includes(t.provider)) throw new Error('AI 服务无效。');
      task.provider = t.provider;
    }
    if (t.usage !== undefined) {
      task.usage = {};
      for (const key of ['inputTokens', 'outputTokens', 'rounds', 'reportedRounds', 'maxRounds']) {
        if (!Number.isSafeInteger(t.usage?.[key]) || t.usage[key] < 0)
          throw new Error('AI 用量数据无效。');
        task.usage[key] = t.usage[key];
      }
    }
    return task;
  });
  const items = input.conversations.items.map((c) => {
    if (!['agent', 'chat'].includes(c.mode)) throw new Error('对话模式无效。');
    return {
      id: str(c.id),
      mode: c.mode,
      title: str(c.title),
      time: number(c.time),
      ...(c.customTitle === undefined ? {} : { customTitle: !!c.customTitle }),
    };
  });
  const selected = {};
  for (const mode of ['agent', 'chat'])
    if (input.conversations.selected[mode] !== undefined)
      selected[mode] = str(input.conversations.selected[mode]);
  // Explicit allowlist excludes credentials, machine paths and CLI session tokens.
  return { version: 1, tasks, conversations: { items, selected } };
}
class AIHistoryStore {
  constructor(userData) {
    this.config = path.join(userData, 'ai-history-location.json');
    this.root = path.join(userData, 'ai-history');
  }
  async init() {
    try {
      const value = JSON.parse(await fs.readFile(this.config, 'utf8'));
      if (!path.isAbsolute(value.root)) throw new Error('AI 数据目录无效。');
      this.root = value.root;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    await fs.mkdir(this.root, { recursive: true });
  }
  filename(id) {
    if (typeof id !== 'string' || !id || id.length > 200) throw new Error('项目标识无效。');
    return path.join(this.root, createHash('sha256').update(id).digest('hex') + '.json');
  }
  async read(id) {
    try {
      const data = JSON.parse(await fs.readFile(this.filename(id), 'utf8'));
      if (data.projectId !== id) throw new Error('AI 项目身份不一致。');
      return validateHistory(data.history);
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }
  async write(id, history) {
    const value = validateHistory(history),
      target = this.filename(id),
      temp = target + '.' + randomUUID() + '.tmp';
    try {
      await fs.writeFile(temp, JSON.stringify({ projectId: id, history: value }), { mode: 0o600 });
      await fs.rename(temp, target);
    } finally {
      await fs.rm(temp, { force: true });
    }
    return value;
  }
  async update(id, patch) {
    const current = (await this.read(id)) || empty();
    return this.write(id, {
      version: 1,
      tasks: patch.tasks ?? current.tasks,
      conversations: patch.conversations ?? current.conversations,
    });
  }
  async clear() {
    for (const name of await fs.readdir(this.root))
      if (/^[a-f0-9]{64}\.json$/.test(name)) {
        const { projectId } = JSON.parse(await fs.readFile(path.join(this.root, name), 'utf8'));
        // Empty records are tombstones: old browser data must not resurrect deleted chats.
        await this.write(projectId, empty());
      }
  }
  async relocate(directory) {
    const parent = await fs.realpath(directory),
      root = path.join(parent, 'Texite-AI-data');
    if (path.resolve(root).toLowerCase() === path.resolve(this.root).toLowerCase())
      return this.root;
    await fs.mkdir(root, { recursive: true });
    const files = (await fs.readdir(this.root)).filter((n) => /^[a-f0-9]{64}\.json$/.test(n));
    const copies = [];
    // Check all collisions before copying; never replace another installation's history.
    for (const name of files) {
      const data = await fs.readFile(path.join(this.root, name));
      try {
        if (!(await fs.readFile(path.join(root, name))).equals(data))
          throw new Error('所选目录包含不同的 AI 记录，请选择空目录。原记录未移动。');
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        copies.push({ name, data });
      }
    }
    for (const { name, data } of copies)
      await fs.writeFile(path.join(root, name), data, { flag: 'wx', mode: 0o600 });
    await fs.writeFile(this.config + '.tmp', JSON.stringify({ root }), { mode: 0o600 });
    await fs.rename(this.config + '.tmp', this.config);
    this.root = root;
    return root;
  }
}
module.exports = { AIHistoryStore, validateHistory, empty };
