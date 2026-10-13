export function chatEndpoint(baseURL) {
  let url;
  try {
    url = new URL(baseURL.trim());
  } catch {
    throw new Error('请输入有效的 API 地址。');
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new Error('API 地址需使用 HTTPS；本机服务可使用 HTTP。');
  url.pathname = url.pathname.replace(/\/$/, '');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions';
  return url.href;
}
export async function streamChat(config, messages, onText, signal, fetcher = fetch) {
  const endpoint = chatEndpoint(config.baseURL);
  if (!config.model?.trim() || config.model.length > 200) throw new Error('请填写模型名称。');
  const response = await fetcher(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: 'Bearer ' + config.apiKey } : {}),
    },
    body: JSON.stringify({ model: config.model, messages, stream: true }),
  });
  if (!response.ok)
    throw new Error(`API 请求失败（HTTP ${response.status}）。请检查地址、模型、密钥或额度。`);
  let count = 0,
    finished = false;
  const emit = (text) => {
    if (typeof text !== 'string' || !text) return;
    count += text.length;
    if (count > 200000) throw new Error('回复超过长度上限。');
    onText(text);
  };
  if (response.headers.get('content-type')?.includes('application/json')) {
    const value = await response.json();
    const text = value.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text)
      throw new Error('API 没有返回文本回复，请确认兼容 Chat Completions。');
    emit(text);
    return;
  }
  if (!response.body) throw new Error('API 没有返回数据。');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let pending = '';
  function event(block) {
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    if (!data) return;
    if (data === '[DONE]') {
      finished = true;
      return;
    }
    let value;
    try {
      value = JSON.parse(data);
    } catch {
      throw new Error('API 返回了无效的流式数据。');
    }
    if (value.error) throw new Error('API 返回错误，请检查模型配置与服务状态。');
    emit(value.choices?.[0]?.delta?.content);
    if (value.choices?.[0]?.finish_reason) finished = true;
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      pending = pending.replace(/\r\n/g, '\n');
      if (pending.length > 1000000) throw new Error('API 返回的数据过大。');
      let end;
      while ((end = pending.indexOf('\n\n')) >= 0) {
        event(pending.slice(0, end));
        pending = pending.slice(end + 2);
      }
      if (done || finished) {
        if (pending.trim()) event(pending);
        break;
      }
    }
    if (!finished || !count) throw new Error('回复连接中断或没有文本，请重试。');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
