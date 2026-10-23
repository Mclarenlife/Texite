const fs = require('node:fs/promises');
const path = require('node:path');
class ChatClient {
  constructor(directory, secureStorage, emit) {
    this.directory = directory;
    this.storage = secureStorage;
    this.emit = emit;
    this.active = null;
    this.settings = null;
    this.settingsQueue = Promise.resolve();
  }
  async loadAll() {
    if (this.settings) return this.settings;
    let saved;
    try {
      saved = JSON.parse(await fs.readFile(path.join(this.directory, 'chat.json'), 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error('无法读取 API 设置，请重新保存。');
    }
    const profiles =
      saved?.profiles ||
      (saved ? [{ ...saved, id: 'legacy', name: saved.model || '默认 API' }] : []);
    this.settings = {
      selected: saved?.selected || profiles[0]?.id,
      profiles: profiles.map((p) => {
        let apiKey = '';
        if (p.secret && this.storage.isEncryptionAvailable())
          try {
            apiKey = this.storage.decryptString(Buffer.from(p.secret, 'base64'));
          } catch {}
        return { id: p.id, name: p.name, baseURL: p.baseURL, model: p.model, apiKey };
      }),
    };
    return this.settings;
  }
  async load() {
    const all = await this.loadAll();
    return (
      all.profiles.find((p) => p.id === all.selected) || {
        baseURL: 'https://api.openai.com/v1',
        model: '',
        apiKey: '',
      }
    );
  }
  publicConfig(p) {
    const { apiKey, ...safe } = p;
    return { ...safe, hasKey: !!apiKey, persistent: this.storage.isEncryptionAvailable() };
  }
  async get() {
    return this.publicConfig(await this.load());
  }
  async list() {
    return (await this.loadAll()).profiles.map((p) => this.publicConfig(p));
  }
  async store(value) {
    const saved = {
      selected: value.selected,
      profiles: value.profiles.map(({ apiKey, ...p }) => ({
        ...p,
        ...(apiKey && this.storage.isEncryptionAvailable()
          ? { secret: this.storage.encryptString(apiKey).toString('base64') }
          : {}),
      })),
    };
    await fs.mkdir(this.directory, { recursive: true });
    const tmp = path.join(this.directory, 'chat.json.tmp');
    await fs.writeFile(tmp, JSON.stringify(saved), { mode: 0o600 });
    await fs.rename(tmp, path.join(this.directory, 'chat.json'));
    this.settings = value;
  }
  enqueueSettings(action) {
    const result = this.settingsQueue.catch(() => {}).then(action);
    this.settingsQueue = result;
    return result;
  }
  select(id) {
    return this.enqueueSettings(() => this.selectProfile(id));
  }
  save(input) {
    return this.enqueueSettings(() => this.saveProfile(input));
  }
  async selectProfile(id) {
    if (this.active) throw new Error('请先停止当前对话。');
    const all = await this.loadAll();
    if (!all.profiles.some((p) => p.id === id)) throw new Error('API 配置不存在。');
    await this.store({ ...all, selected: id });
    return this.get();
  }
  async saveProfile(input) {
    if (this.active) throw new Error('请先停止当前对话。');
    const { chatEndpoint } = await import('./chat-transport.mjs');
    if (
      !input ||
      typeof input.baseURL !== 'string' ||
      typeof input.model !== 'string' ||
      input.model.length > 200 ||
      typeof input.apiKey !== 'string' ||
      input.apiKey.length > 10000 ||
      (input.name !== undefined && (typeof input.name !== 'string' || input.name.length > 100)) ||
      (input.id !== undefined && (typeof input.id !== 'string' || input.id.length > 100))
    )
      throw new Error('API 设置无效。');
    chatEndpoint(input.baseURL);
    const all = await this.loadAll();
    // Older clients omit id and continue editing the active configuration. Empty id explicitly creates one.
    const id =
      input.id === ''
        ? require('node:crypto').randomUUID()
        : input.id || all.selected || require('node:crypto').randomUUID();
    const previous = all.profiles.find((p) => p.id === id);
    if (!previous && all.profiles.length >= 30) throw new Error('最多保存 30 个 API 配置。');
    const next = {
      id,
      name: input.name?.trim() || input.model.trim(),
      baseURL: input.baseURL.trim(),
      model: input.model.trim(),
      apiKey:
        input.apiKey ||
        (previous?.baseURL === input.baseURL.trim() && !input.clearKey ? previous.apiKey : ''),
    };
    if (!next.model) throw new Error('请填写模型名称。');
    await this.store({
      selected: id,
      profiles: [...all.profiles.filter((p) => p.id !== id), next],
    });
    return this.get();
  }
  async start(input) {
    if (this.active) throw new Error('已有 API 对话正在运行。');
    if (
      !input ||
      typeof input.runId !== 'string' ||
      typeof input.projectId !== 'string' ||
      !Array.isArray(input.messages) ||
      input.messages.length > 40 ||
      input.messages.some(
        (m) =>
          !m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string',
      ) ||
      JSON.stringify(input.messages).length > 150000
    )
      throw new Error('对话请求无效或过长。');
    const controller = new AbortController();
    this.active = controller;
    const emit = (data) => this.emit({ ...data, runId: input.runId, projectId: input.projectId });
    const timer = setTimeout(() => controller.abort(), 180000);
    try {
      const { streamChat } = await import('./chat-transport.mjs');
      await streamChat(
        await this.load(),
        input.messages,
        (delta) => emit({ type: 'text', delta }),
        controller.signal,
      );
      emit({ type: 'done', status: 'completed' });
    } catch (e) {
      emit({
        type: 'done',
        status: controller.signal.aborted ? 'interrupted' : 'failed',
        error: controller.signal.aborted
          ? undefined
          : /API|模型|回复/.test(e.message)
            ? e.message
            : '无法连接 API，请检查网络和地址。',
      });
    } finally {
      clearTimeout(timer);
      if (this.active === controller) this.active = null;
    }
  }
  cancel() {
    this.active?.abort();
  }
}
module.exports = { ChatClient };
