import type { AIController } from '../workbench/useAI';
import { Select } from './Select';

const labels: Record<string, string> = {
  none: '关闭思考',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
  ultra: '最高',
};

export function ReasoningSelect({
  ai,
  literature = false,
  disabled = false,
}: {
  ai: AIController;
  literature?: boolean;
  disabled?: boolean;
}) {
  const models = ai.connection?.models || [];
  const selected =
    models.find((m) => m.id === ai.model) || models.find((m) => m.isDefault) || models[0];
  const options =
    ai.agentConfig.protocol === 'codex'
      ? (selected?.reasoningEfforts || []).map((value) => ({
          value,
          label: labels[value] || value,
        }))
      : (ai.connection?.reasoningOptions || []).map((o) => ({
          ...o,
          label: labels[o.value] || o.label,
        }));
  const value = literature ? ai.literatureReasoningEffort : ai.reasoningEffort;
  const onChange = literature ? ai.setLiteratureReasoningEffort : ai.setReasoningEffort;
  return (
    <Select
      aria-label={literature ? '文献检索思考强度' : 'AI 思考强度'}
      value={value}
      disabled={disabled || ai.busy || ai.connecting}
      onValueChange={onChange}
    >
      <option value="">
        {ai.connection ? (options.length ? '思考 · 默认' : '思考 · CLI 默认') : '思考 · 连接后选择'}
      </option>
      {value && !options.some((o) => o.value === value) && (
        <option value={value} disabled>
          {labels[value] || value} · {ai.connection ? '当前不可用' : '已保存'}
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          思考 · {o.label}
        </option>
      ))}
    </Select>
  );
}
