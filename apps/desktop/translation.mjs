import { chatEndpoint, streamChat } from './chat-transport.mjs';

export const languages = { zh: '简体中文', en: '英语', ja: '日语', de: '德语', fr: '法语' };
export const providers = { deepl: 'DeepL', libre: 'LibreTranslate', ai: 'AI API' };
export const defaults = { provider: 'libre', target: 'zh', url: '', model: '', apiKey: '' };

function endpoint(provider, value) {
  if (provider === 'ai') return chatEndpoint(value);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('请填写有效的服务地址。');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(url.protocol === 'https:' || (local && url.protocol === 'http:'))
  ) {
    throw new Error('请使用 HTTPS 地址，本机服务也可使用 HTTP。');
  }
  if (provider === 'deepl') {
    if (!['https://api-free.deepl.com', 'https://api.deepl.com'].includes(url.origin))
      throw new Error('请选择 DeepL Free 或 Pro 服务。');
    return url.origin + '/v2/translate';
  }
  const base = url.href.replace(/\/+$/, '');
  return base.endsWith('/translate') ? base : base + '/translate';
}

export function createTranslationService({ read, write, persistent }, fetcher = fetch) {
  let state;
  let queue = Promise.resolve();
  const requests = new Map();
  const load = () =>
    (state ??= Promise.resolve()
      .then(read)
      .then((value) => value || defaults)
      .catch((error) => {
        state = undefined;
        throw error;
      }));
  async function get() {
    const { apiKey, ...config } = await load();
    return { ...config, hasKey: !!apiKey, persistent: persistent() };
  }
  function save(input) {
    const task = queue.then(async () => {
      if (
        !input ||
        !Object.hasOwn(providers, input.provider) ||
        !Object.hasOwn(languages, input.target) ||
        typeof input.url !== 'string' ||
        input.url.length > 2048 ||
        typeof input.model !== 'string' ||
        input.model.length > 200 ||
        typeof input.apiKey !== 'string' ||
        input.apiKey.length > 10000
      )
        throw new Error('翻译配置无效。');
      const { provider, target } = input;
      const url = input.url.trim(),
        model = input.model.trim();
      const address = endpoint(provider, url);
      const old = await load();
      const same = old.url && old.provider === provider && endpoint(provider, old.url) === address;
      const apiKey = input.apiKey.trim() || (same && !input.clearKey ? old.apiKey : '');
      if (provider === 'ai' && !model) throw new Error('请填写模型名称。');
      if (provider === 'deepl' && !apiKey) throw new Error('请填写 DeepL API Key。');
      const value = { provider, target, url, model, apiKey };
      await write(value);
      state = Promise.resolve(value);
      return get();
    });
    queue = task.catch(() => {});
    return task;
  }
  async function translate(id, text) {
    if (
      typeof id !== 'string' ||
      id.length > 100 ||
      requests.has(id) ||
      typeof text !== 'string' ||
      !text.trim()
    )
      throw new Error('请选择需要翻译的文字。');
    if (text.length > 16000) throw new Error('一次最多翻译 16000 个字符，请缩短选区。');
    const controller = new AbortController();
    requests.set(id, controller);
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const { provider, target, url, model, apiKey } = await load();
      if (!url) throw new Error('请先在翻译设置中配置服务。');
      const address = endpoint(provider, url);
      const signal = controller.signal;
      if (provider === 'ai') {
        let result = '';
        await streamChat(
          { baseURL: url, model, apiKey },
          [
            {
              role: 'system',
              content:
                '将用户提供的文稿原文翻译为' +
                languages[target] +
                '。仅返回译文，保留公式、段落和专业术语。',
            },
            { role: 'user', content: text },
          ],
          (chunk) => {
            result += chunk;
          },
          signal,
          fetcher,
        );
        return result;
      }
      const deep = provider === 'deepl';
      const response = await fetcher(address, {
        method: 'POST',
        redirect: 'error',
        signal,
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          ...(deep ? { Authorization: 'DeepL-Auth-Key ' + apiKey } : {}),
        },
        body: JSON.stringify(
          deep
            ? { text: [text], target_lang: target === 'zh' ? 'ZH-HANS' : target.toUpperCase() }
            : {
                q: text,
                source: 'auto',
                target,
                format: 'text',
                ...(apiKey ? { api_key: apiKey } : {}),
              },
        ),
      });
      if (!response.ok)
        throw new Error('翻译服务返回 HTTP ' + response.status + '，请检查地址、密钥或额度。');
      const data = await response.json();
      const result = deep ? data.translations?.[0]?.text : data.translatedText;
      if (typeof result !== 'string' || !result.trim()) throw new Error('翻译服务没有返回译文。');
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('翻译已取消或超时。');
      if (error instanceof TypeError)
        throw new Error('无法连接翻译服务，请检查网络和服务地址。网页端需要服务允许跨域请求。');
      throw error;
    } finally {
      clearTimeout(timer);
      requests.delete(id);
    }
  }
  return {
    get,
    save,
    translate,
    cancel(id) {
      requests.get(id)?.abort();
    },
  };
}
