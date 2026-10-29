import { chatEndpoint } from './chat-transport.mjs';
import { agentTools, agentInstructions } from './agent-tools.mjs';

export function validateRounds(value) {
  if (!Number.isInteger(value) || value < 1 || value > 30)
    throw new Error('API Agent 最大执行轮数需为 1–30。');
  return value;
}
function usageOf(raw) {
  if (
    !raw ||
    !Number.isSafeInteger(raw.prompt_tokens) ||
    !Number.isSafeInteger(raw.completion_tokens) ||
    raw.prompt_tokens < 0 ||
    raw.completion_tokens < 0
  )
    return null;
  return { inputTokens: raw.prompt_tokens, outputTokens: raw.completion_tokens };
}
// Wait for the usage trailer after finish_reason; never execute partially received tools.
export async function agentCompletion(config, messages, onText, signal, fetcher = fetch) {
  const response = await fetcher(chatEndpoint(config.baseURL), {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: 'Bearer ' + config.apiKey } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      tools: agentTools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      })),
      tool_choice: 'auto',
      parallel_tool_calls: false,
    }),
  });
  if (!response.ok)
    throw new Error(
      `API 请求失败（HTTP ${response.status}）。Agent 需要支持 tools 和流式用量的 Chat Completions 接口。`,
    );
  let content = '',
    usage = null,
    reason = '',
    finished = false,
    received = 0;
  const calls = new Map();
  function consume(value, full = false) {
    if (value.error) throw new Error('API 返回错误，请检查服务与模型配置。');
    usage = usageOf(value.usage) || usage;
    const choice = value.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) reason = choice.finish_reason;
    const delta = full ? choice.message : choice.delta;
    if (typeof delta?.content === 'string') {
      content += delta.content;
      if (content.length > 100000) throw new Error('API 回复过长。');
      onText(delta.content);
    }
    for (const [position, part] of (delta?.tool_calls || []).entries()) {
      const index = full ? position : part.index;
      if (!Number.isInteger(index) || index < 0 || index >= 8)
        throw new Error('API 工具调用数量或索引无效。');
      const call = calls.get(index) || {
        id: '',
        type: 'function',
        function: { name: '', arguments: '' },
      };
      if (part.id) call.id = part.id;
      if (typeof part.function?.name === 'string') call.function.name += part.function.name;
      if (typeof part.function?.arguments === 'string')
        call.function.arguments += part.function.arguments;
      if (call.function.arguments.length > 100000 || call.function.name.length > 100)
        throw new Error('API 工具参数过长。');
      calls.set(index, call);
    }
  }
  if (response.headers.get('content-type')?.includes('application/json')) {
    const text = await response.text();
    if (text.length > 1000000) throw new Error('API 数据过长。');
    consume(JSON.parse(text), true);
    finished = true;
  } else {
    if (!response.body) throw new Error('API 没有返回数据。');
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let pending = '';
    const event = (block) => {
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      if (!data) return;
      if (data === '[DONE]') {
        finished = true;
        return;
      }
      consume(JSON.parse(data));
    };
    try {
      while (!finished) {
        const { value, done } = await reader.read();
        received += value?.length || 0;
        if (received > 2000000) throw new Error('API 数据过长。');
        pending += decoder.decode(value, { stream: !done });
        pending = pending.replace(/\r\n/g, '\n');
        let end;
        while ((end = pending.indexOf('\n\n')) >= 0) {
          event(pending.slice(0, end));
          pending = pending.slice(end + 2);
        }
        if (done) {
          if (pending.trim()) event(pending);
          break;
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  if (!finished && !reason) throw new Error('API 连接中断，未执行不完整的工具调用。');
  if (!['stop', 'tool_calls'].includes(reason))
    throw new Error('API 回复未完整结束（可能达到模型输出限制），请缩小任务后重试。');
  const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call);
  if (
    toolCalls.some((c) => !c.id || !c.function.name) ||
    new Set(toolCalls.map((c) => c.id)).size !== toolCalls.length
  )
    throw new Error('API 工具调用标识无效。');
  if ((!toolCalls.length && !content) || (reason === 'tool_calls' && !toolCalls.length))
    throw new Error('API 没有返回回复或工具调用。');
  return {
    message: {
      role: 'assistant',
      content: content || null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    },
    toolCalls,
    usage,
  };
}

export async function runAPIAgent(config, input, emit, execute, signal, fetcher = fetch) {
  const maxRounds = validateRounds(input.maxRounds);
  if (!config.model?.trim()) throw new Error('请先配置 API 模型。');
  const messages = [{ role: 'system', content: agentInstructions }, ...input.messages];
  const totals = { inputTokens: 0, outputTokens: 0, reportedRounds: 0, rounds: 0, maxRounds };
  for (let round = 1; round <= maxRounds; round++) {
    signal.throwIfAborted();
    if (JSON.stringify(messages).length > 240000)
      throw new Error('Agent 上下文达到上限，请新建对话或缩小任务。');
    emit({ type: 'activity', text: `API 请求 · 第 ${round}/${maxRounds} 轮` });
    totals.rounds = round;
    emit({ type: 'usage', usage: { ...totals } });
    const result = await agentCompletion(
      config,
      messages,
      (delta) => emit({ type: 'text', delta }),
      signal,
      fetcher,
    );
    if (result.usage) {
      totals.inputTokens += result.usage.inputTokens;
      totals.outputTokens += result.usage.outputTokens;
      totals.reportedRounds++;
    }
    emit({ type: 'usage', usage: { ...totals } });
    if (!result.toolCalls.length) return;
    messages.push(result.message);
    for (const call of result.toolCalls) {
      signal.throwIfAborted();
      let value;
      try {
        if (!agentTools.some((t) => t.name === call.function.name))
          throw new Error('不支持此工具。');
        const args = JSON.parse(call.function.arguments);
        if (!args || Array.isArray(args) || typeof args !== 'object')
          throw new Error('工具参数必须为对象。');
        value = await execute(call.function.name, args);
      } catch (error) {
        value = { success: false, value: error.message };
      }
      signal.throwIfAborted();
      const content = JSON.stringify(value);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content:
          content.length <= 40000
            ? content
            : JSON.stringify({ success: false, value: '工具结果过长，请缩小读取或搜索范围。' }),
      });
    }
    emit({ type: 'text', delta: '\n\n' });
  }
  throw new Error(
    `已达到 ${maxRounds} 轮 API 请求上限，任务已停止。已应用的修改和撤回记录已保留。`,
  );
}
