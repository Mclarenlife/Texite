const fs = require('node:fs/promises');
const path = require('node:path');
const { CodexClient } = require('./codex-client.cjs');
const { ACPClient } = require('./acp-client.cjs');

const presets = {
  codex: { protocol: 'codex', command: '', args: [] },
  claude: { protocol: 'acp', command: 'claude-agent-acp', args: [] },
  qwen: { protocol: 'acp', command: 'qwen', args: ['--acp'] },
  minimax: { protocol: 'acp', command: 'opencode', args: ['acp'] },
  deepseek: { protocol: 'acp', command: 'opencode', args: ['acp'] },
  custom: { protocol: 'acp', command: '', args: [] },
};
class AgentClient {
  constructor(directory, emit) {
    this.directory = directory;
    this.emit = emit;
    this.client = null;
    this.config = null;
    this.transition = false;
    this.idleMinutes = 5;
    this.lifecycle = 0;
    this.idleTimer = null;
  }
  get active() {
    return this.client?.active || this.transition || !!this.disconnecting;
  }
  async getIdleSettings() {
    if (!this.idleLoaded) {
      try {
        const saved = JSON.parse(
          await fs.readFile(path.join(this.directory, 'connection.json'), 'utf8'),
        );
        if ([0, 1, 5, 10, 30].includes(saved.idleMinutes)) this.idleMinutes = saved.idleMinutes;
      } catch (e) {
        if (e.code !== 'ENOENT') throw new Error('无法读取自动断开设置。');
      }
      this.idleLoaded = true;
    }
    return { idleMinutes: this.idleMinutes };
  }
  async setIdleSettings(input) {
    if (!input || ![0, 1, 5, 10, 30].includes(input.idleMinutes))
      throw new Error('空闲时间设置无效。');
    await fs.mkdir(this.directory, { recursive: true });
    await fs.writeFile(
      path.join(this.directory, 'connection.json'),
      JSON.stringify({ idleMinutes: input.idleMinutes }),
    );
    this.idleLoaded = true;
    this.idleMinutes = input.idleMinutes;
    this.armIdle();
    return this.getIdleSettings();
  }
  armIdle() {
    clearTimeout(this.idleTimer);
    if (!this.idleMinutes || this.active || !this.client?.connection) return;
    this.idleTimer = setTimeout(() => {
      if (!this.active)
        void this.disconnect('idle').catch((e) =>
          this.emit({ type: 'connection', reason: 'error', error: e.message }),
        );
    }, this.idleMinutes * 60000);
    this.idleTimer.unref?.();
  }
  async getProfiles() {
    try {
      return JSON.parse(
        await fs.readFile(path.join(this.directory, 'agent-profiles.json'), 'utf8'),
      );
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error('无法读取 CLI 配置列表。');
      return [await this.getConfig()];
    }
  }
  async getConfig() {
    if (this.config) return this.config;
    try {
      this.config = JSON.parse(await fs.readFile(path.join(this.directory, 'agent.json'), 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error('无法读取 Agent CLI 设置。');
    }
    return (this.config ||= { preset: 'codex', ...presets.codex });
  }
  async configure(input) {
    if (this.active) throw new Error('请先结束当前任务或连接操作。');
    if (
      !input ||
      !Object.hasOwn(presets, input.preset) ||
      !['codex', 'acp'].includes(input.protocol) ||
      typeof input.command !== 'string' ||
      input.command.length > 4096 ||
      /[\r\n\0]/.test(input.command) ||
      !Array.isArray(input.args) ||
      input.args.length > 30 ||
      input.args.some((a) => typeof a !== 'string' || a.length > 4096 || a.includes('\0')) ||
      (input.model !== undefined && (typeof input.model !== 'string' || input.model.length > 200))
    )
      throw new Error('Agent CLI 设置无效。');
    if (input.protocol === 'acp' && !input.command.trim())
      throw new Error('请填写 ACP 程序路径或命令名。');
    this.transition = true;
    clearTimeout(this.idleTimer);
    try {
      const next = {
        preset: input.preset,
        protocol: input.protocol,
        command: input.command.trim(),
        args: input.args,
        model: input.model?.trim() || '',
      };
      await fs.mkdir(this.directory, { recursive: true });
      const profiles = await this.getProfiles();
      await fs.writeFile(
        path.join(this.directory, 'agent-profiles.json.tmp'),
        JSON.stringify([...profiles.filter((p) => p.preset !== next.preset), next]),
        { mode: 0o600 },
      );
      await fs.rename(
        path.join(this.directory, 'agent-profiles.json.tmp'),
        path.join(this.directory, 'agent-profiles.json'),
      );
      await fs.writeFile(path.join(this.directory, 'agent.json.tmp'), JSON.stringify(next), {
        mode: 0o600,
      });
      await fs.rename(
        path.join(this.directory, 'agent.json.tmp'),
        path.join(this.directory, 'agent.json'),
      );
      await this.client?.disconnect();
      this.client = null;
      this.config = next;
      return next;
    } finally {
      this.transition = false;
    }
  }
  async connect() {
    if (this.active) throw new Error('请先结束当前任务或连接操作。');
    this.transition = true;
    const lifecycle = this.lifecycle;
    clearTimeout(this.idleTimer);
    try {
      await this.getIdleSettings();
      const config = await this.getConfig();
      if (lifecycle !== this.lifecycle) throw new Error('连接已取消。');
      if (!this.client) {
        const emit = (event) => {
          this.emit(event);
          if (event.type === 'done') this.armIdle();
        };
        this.client =
          config.protocol === 'codex'
            ? new CodexClient(this.directory, emit)
            : new ACPClient(this.directory, config, emit);
      }
      const client = this.client;
      this.connectPending = (async () => {
        if (config.protocol === 'codex' && config.command)
          await client.chooseBinary(config.command);
        if (lifecycle !== this.lifecycle) throw new Error('连接已取消。');
        return client.connect();
      })();
      const connection = await this.connectPending;
      if (lifecycle !== this.lifecycle) {
        await client.disconnect();
        throw new Error('连接已取消。');
      }
      return connection;
    } finally {
      this.transition = false;
      this.armIdle();
    }
  }
  async chooseBinary(file) {
    const config = await this.getConfig();
    if (!(await fs.stat(file)).isFile()) throw new Error('请选择 CLI 文件，而不是应用包或文件夹。');
    await this.configure({ ...config, command: file });
    return file;
  }
  async start(input) {
    if (this.disconnecting) await this.disconnecting;
    if (this.transition) throw new Error('CLI 正在连接，请稍后重试。');
    if (!this.client?.connection) {
      const connection = await this.connect();
      this.emit({ type: 'connection', reason: 'connected', connection });
      if (!connection.authenticated) throw new Error('请先在终端登录 Agent CLI。');
    }
    clearTimeout(this.idleTimer);
    try {
      return await this.client.start(input);
    } finally {
      this.armIdle();
    }
  }
  reply(...args) {
    return this.client?.reply(...args);
  }
  cancel() {
    return this.client?.cancel();
  }
  clearHistory(...args) {
    return this.client?.clearHistory(...args);
  }
  async disconnect(reason = 'manual') {
    if (this.disconnecting) return this.disconnecting;
    ++this.lifecycle;
    clearTimeout(this.idleTimer);
    const client = this.client;
    this.disconnecting = (async () => {
      await client?.disconnect();
      await this.connectPending?.catch(() => {});
      await client?.disconnect();
      if (this.client === client) this.client = null;
      clearTimeout(this.idleTimer);
      this.emit({ type: 'connection', reason });
    })();
    try {
      await this.disconnecting;
    } finally {
      this.disconnecting = null;
    }
  }
}
module.exports = { AgentClient, presets };
