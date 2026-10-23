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
  }
  get active() {
    return this.client?.active || this.transition;
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
    try {
      const config = await this.getConfig();
      if (!this.client) {
        this.client =
          config.protocol === 'codex'
            ? new CodexClient(this.directory, this.emit)
            : new ACPClient(this.directory, config, this.emit);
        if (config.protocol === 'codex' && config.command)
          await this.client.chooseBinary(config.command);
      }
      return await this.client.connect();
    } finally {
      this.transition = false;
    }
  }
  async chooseBinary(file) {
    const config = await this.getConfig();
    if (!(await fs.stat(file)).isFile()) throw new Error('请选择 CLI 文件，而不是应用包或文件夹。');
    await this.configure({ ...config, command: file });
    return file;
  }
  async start(input) {
    if (this.transition || !this.client) throw new Error('请先连接 Agent CLI。');
    return this.client.start(input);
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
  async disconnect() {
    await this.client?.disconnect();
    this.client = null;
  }
}
module.exports = { AgentClient, presets };
