import { useEffect, useState } from 'react';
import type { AgentConfig } from '../core/ai';
import type { AIController } from '../workbench/useAI';
import { Select } from './Select';
const presets: Record<
  AgentConfig['preset'],
  { name: string; command: string; args: string[]; hint: string }
> = {
  codex: {
    name: 'Codex CLI',
    command: '',
    args: [],
    hint: '使用原生 app-server 接口；留空自动查找程序。',
  },
  claude: {
    name: 'Claude',
    command: 'claude-agent-acp',
    args: [],
    hint: '需要已安装并登录的 Claude ACP 适配器（claude-agent-acp）。',
  },
  qwen: {
    name: 'Qwen Code',
    command: 'qwen',
    args: ['--acp'],
    hint: '使用 Qwen Code 的 ACP 模式；先在终端完成登录。',
  },
  minimax: {
    name: 'MiniMax · OpenCode',
    command: 'opencode',
    args: ['acp'],
    hint: '先在 OpenCode 配置 MiniMax 服务，再填写该 CLI 提供的模型 ID。',
  },
  deepseek: {
    name: 'DeepSeek · OpenCode',
    command: 'opencode',
    args: ['acp'],
    hint: '先在 OpenCode 配置 DeepSeek 服务，再填写该 CLI 提供的模型 ID。',
  },
  custom: {
    name: '自定义 ACP CLI',
    command: '',
    args: [],
    hint: '支持 ACP v1、标准输入输出及编辑器文件读写的 CLI 或适配器。',
  },
};
export function AgentSettings({ ai, onDone }: { ai: AIController; onDone(): void }) {
  const [config, setConfig] = useState(ai.agentConfig);
  const [args, setArgs] = useState(JSON.stringify(config.args));
  const [profiles, setProfiles] = useState<AgentConfig[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void window.texite?.ai
      ?.getProfiles?.()
      .then(setProfiles)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <form
      className="api-settings"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        setSaving(true);
        try {
          const argv = JSON.parse(args);
          if (!Array.isArray(argv) || argv.some((a) => typeof a !== 'string'))
            throw new Error('参数应为 JSON 字符串数组，例如 ["--acp"]。');
          await ai.configureAgent({ ...config, args: argv });
          if (await ai.connect()) onDone();
          else
            setError(
              '未能连接。请检查程序路径、ACP 适配器和终端登录状态。详细错误会显示在助手输入区。',
            );
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setSaving(false);
        }
      }}
    >
      <label>
        Agent CLI
        <Select
          aria-label="Agent CLI 类型"
          value={config.preset}
          onValueChange={(value) => {
            const preset = value as AgentConfig['preset'],
              saved = profiles.find((p) => p.preset === preset);
            const next: AgentConfig = saved || {
              preset,
              protocol: preset === 'codex' ? 'codex' : 'acp',
              command: presets[preset].command,
              args: presets[preset].args,
              model: '',
            };
            setConfig(next);
            setArgs(JSON.stringify(next.args));
          }}
        >
          {Object.entries(presets).map(([id, p]) => (
            <option key={id} value={id}>
              {p.name}
            </option>
          ))}
        </Select>
      </label>
      <p>{presets[config.preset].hint}</p>
      <label>
        程序路径 / 命令名
        <input
          aria-label="Agent CLI 程序"
          value={config.command}
          onChange={(e) => setConfig({ ...config, command: e.target.value })}
          placeholder={config.preset === 'codex' ? '自动查找' : '程序的完整路径或 PATH 中的命令名'}
        />
      </label>
      {config.protocol === 'acp' && (
        <>
          <label>
            启动参数
            <input
              aria-label="Agent CLI 参数"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder={'["--acp"]'}
            />
          </label>
          <label>
            默认模型（可选）
            <input
              aria-label="Agent CLI 默认模型"
              value={config.model || ''}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              placeholder="CLI 返回的完整模型 ID"
            />
          </label>
          <p>
            CLI 使用其本机账户和配置；仅连接你信任的程序。Texite
            通过编辑器接口校验修改，不提供终端执行权限。不同 CLI 的 ACP 文件读写能力可能有差异。
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="secondary-button" onClick={onDone}>
          取消
        </button>
        <button className="primary-button" disabled={saving || ai.busy}>
          {saving ? '连接中…' : '保存并连接'}
        </button>
      </div>
    </form>
  );
}
