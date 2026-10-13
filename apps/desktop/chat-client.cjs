const fs = require('node:fs/promises');
const path = require('node:path');
class ChatClient {
  constructor(directory, secureStorage, emit) {
    this.directory = directory;
    this.storage = secureStorage;
    this.emit = emit;
    this.active = null;
    this.settings = null;
  }
  async load() {
    if (this.settings) return this.settings;
    let saved = { baseURL: 'https://api.openai.com/v1', model: '' };
    try {
      saved = JSON.parse(await fs.readFile(path.join(this.directory, 'chat.json'), 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error('无法读取 API 设置，请重新保存。');
    }
    let apiKey = '';
    if (saved.secret && this.storage.isEncryptionAvailable())
      try {
        apiKey = this.storage.decryptString(Buffer.from(saved.secret, 'base64'));
      } catch {}
    this.settings = { baseURL: saved.baseURL, model: saved.model, apiKey };
    return this.settings;
  }
  async get() {
    const s = await this.load();
    return {
      baseURL: s.baseURL,
      model: s.model,
      hasKey: !!s.apiKey,
      persistent: this.storage.isEncryptionAvailable(),
    };
  }
  async save(input) {
    if (this.active) throw new Error('请先停止当前对话。');
    const { chatEndpoint } = await import('./chat-transport.mjs');
    if (
      !input ||
      typeof input.baseURL !== 'string' ||
      typeof input.model !== 'string' ||
      input.model.length > 200 ||
      typeof input.apiKey !== 'string' ||
      input.apiKey.length > 10000
    )
      throw new Error('API 设置无效。');
    chatEndpoint(input.baseURL);
    const previous = await this.load();
    const next = {
      baseURL: input.baseURL.trim(),
      model: input.model.trim(),
      apiKey:
        input.apiKey ||
        (previous.baseURL === input.baseURL.trim() && !input.clearKey ? previous.apiKey : ''),
    };
    if (!next.model) throw new Error('请填写模型名称。');
    const saved = { baseURL: next.baseURL, model: next.model };
    if (next.apiKey && this.storage.isEncryptionAvailable())
      saved.secret = this.storage.encryptString(next.apiKey).toString('base64');
    await fs.mkdir(this.directory, { recursive: true });
    await fs.writeFile(path.join(this.directory, 'chat.json'), JSON.stringify(saved), {
      mode: 0o600,
    });
    this.settings = next;
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
