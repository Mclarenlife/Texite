import { useEffect, useState } from 'react';
import {
  defaults,
  languages,
  providers,
  type Provider,
  type Target,
  type PublicConfig,
} from '../../apps/desktop/translation.mjs';
import { translationAPI } from '../platform/translation';
import { Select } from './Select';
import './translation.css';

export function TranslationSettings({ onSaved }: { onSaved?: () => void }) {
  const [saved, setSaved] = useState<PublicConfig>();
  const [form, setForm] = useState(defaults);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let live = true;
    translationAPI()
      .get()
      .then((config) => {
        if (live) {
          setSaved(config);
          setForm({ ...config, apiKey: '' });
        }
      })
      .catch((error) => {
        if (live) setMessage(error.message);
      });
    return () => {
      live = false;
    };
  }, []);
  const keepsKey = saved?.hasKey && saved.provider === form.provider && saved.url === form.url;
  return (
    <form
      className="translation-settings"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage('');
        try {
          const config = await translationAPI().save(form);
          setSaved(config);
          setForm({ ...config, apiKey: '' });
          setMessage('翻译设置已保存。');
          onSaved?.();
        } catch (error) {
          setMessage((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy || !saved}>
        <label>
          翻译引擎
          <Select
            aria-label="翻译引擎"
            value={form.provider}
            onValueChange={(value) => {
              const provider = value as Provider;
              setMessage('');
              setForm({
                ...form,
                provider,
                apiKey: '',
                model: provider === saved?.provider ? saved.model : '',
                url:
                  provider === saved?.provider
                    ? saved.url
                    : provider === 'deepl'
                      ? 'https://api-free.deepl.com'
                      : '',
              });
            }}
          >
            {Object.entries(providers)
              .filter(([id]) => id !== 'deepl' || window.texite?.translation)
              .map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
          </Select>
        </label>
        <label>
          目标语言
          <Select
            aria-label="翻译目标语言"
            value={form.target}
            onValueChange={(target) => setForm({ ...form, target: target as Target })}
          >
            {Object.entries(languages).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        {form.provider === 'deepl' ? (
          <label>
            服务版本
            <Select
              aria-label="DeepL 服务版本"
              value={form.url}
              onValueChange={(url) => setForm({ ...form, url, apiKey: '' })}
            >
              <option value="https://api-free.deepl.com">DeepL API Free</option>
              <option value="https://api.deepl.com">DeepL API Pro</option>
            </Select>
          </label>
        ) : (
          <label>
            {form.provider === 'ai' ? 'AI API 地址' : 'LibreTranslate 地址'}
            <input
              required
              type="url"
              value={form.url}
              placeholder={
                form.provider === 'ai'
                  ? 'https://api.example.com/v1'
                  : 'https://translate.example.com'
              }
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          </label>
        )}
        {form.provider === 'ai' && (
          <label>
            模型名称
            <input
              required
              value={form.model}
              placeholder="服务商提供的模型 ID"
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />
          </label>
        )}
        <label>
          API Key
          <input
            type="password"
            autoComplete="new-password"
            value={form.apiKey}
            placeholder={keepsKey ? '已配置，留空保留' : '按服务要求填写'}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          />
        </label>
        <small>
          点击翻译时，仅发送选中的文字。{saved && !saved.persistent && '密钥仅在本次会话有效。'}
          {form.provider === 'ai' && ' 使用兼容 Chat Completions 的 API。'}
        </small>
        <button className="primary-button" type="submit">
          保存翻译设置
        </button>
      </fieldset>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
